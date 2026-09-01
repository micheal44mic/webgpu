import {
  createHomeEditorWarmupController,
  type HomeEditorWarmupController,
  type HomeEditorPreGpuWarmupTask,
  type HomeEditorWarmupTask,
} from "./home-editor-warmup-controller";

type StrokeProgramsModule = typeof import("./stroke-programs");
type LayerOptionsProgramsModule = typeof import("./layer-blend-tile-programs");
type TransformProgramsModule = typeof import("./raster-transform-programs");

let strokeProgramsModule: Promise<StrokeProgramsModule> | null = null;
let layerOptionsProgramsModule: Promise<LayerOptionsProgramsModule> | null = null;
let transformProgramsModule: Promise<TransformProgramsModule> | null = null;

function stageStrokeProgramsModule(): Promise<StrokeProgramsModule> {
  const pending = strokeProgramsModule ?? import("./stroke-programs");
  strokeProgramsModule = pending;
  void pending.catch(() => {
    if (strokeProgramsModule === pending) strokeProgramsModule = null;
  });
  return pending;
}

function stageLayerOptionsProgramsModule(): Promise<LayerOptionsProgramsModule> {
  const pending = layerOptionsProgramsModule ?? import("./layer-blend-tile-programs");
  layerOptionsProgramsModule = pending;
  void pending.catch(() => {
    if (layerOptionsProgramsModule === pending) layerOptionsProgramsModule = null;
  });
  return pending;
}

function stageTransformProgramsModule(): Promise<TransformProgramsModule> {
  const pending = transformProgramsModule ?? import("./raster-transform-programs");
  transformProgramsModule = pending;
  void pending.catch(() => {
    if (transformProgramsModule === pending) transformProgramsModule = null;
  });
  return pending;
}

interface NetworkInformationLike {
  readonly saveData?: boolean;
}

function browserRequestsReducedData(browser: Window): boolean {
  const connection = (browser.navigator as Navigator & {
    readonly connection?: NetworkInformationLike;
  }).connection;
  return connection?.saveData === true;
}

export function homeEditorWarmupEnabled(search: URLSearchParams): boolean {
  return search.get("homeGpuWarmup") !== "off";
}

export function createDefaultHomeEditorWarmup(options: {
  readonly enabled: boolean;
  readonly browser?: Window;
  readonly document?: Document;
}): HomeEditorWarmupController {
  const browser = options.browser ?? window;
  const preGpuTasks: readonly HomeEditorPreGpuWarmupTask[] = [
    {
      id: "program-module-sources",
      async run({ yieldToHome, editorOpening }) {
        const modules = [
          ["stroke", stageStrokeProgramsModule],
          ["layer-options", stageLayerOptionsProgramsModule],
          ["transform", stageTransformProgramsModule],
        ] as const;
        const loaded: string[] = [];
        for (let index = 0; index < modules.length; index += 1) {
          if (editorOpening()) break;
          const [id, stage] = modules[index];
          await stage();
          loaded.push(id);
          if (index + 1 < modules.length) await yieldToHome();
        }
        return {
          loaded,
          skipped: modules.length - loaded.length,
        };
      },
    },
    {
      id: "immutable-asset-sources",
      async run({ yieldToHome, editorOpening }) {
        if (browserRequestsReducedData(browser)) {
          return { skipped: "save-data" };
        }
        const { preloadHomeEditorAssetSources } = await import(
          "./home-editor-asset-preloader"
        );
        return await preloadHomeEditorAssetSources({
          yieldBetweenEntries: yieldToHome,
          continueWhile: () => !editorOpening(),
        });
      },
    },
  ];
  const tasks: readonly HomeEditorWarmupTask[] = [
    {
      id: "stroke-programs",
      blocksEditorDeviceUse: true,
      async run({ session }) {
        const { prewarmRasterStrokePrograms } = await stageStrokeProgramsModule();
        await prewarmRasterStrokePrograms({
          device: session.device,
          layerFormat: "rgba16float",
        });
        return { format: "rgba16float", programCount: 8 };
      },
    },
    {
      id: "layer-options-programs",
      async run({ session }) {
        const { prewarmLayerBlendTilePrograms } =
          await stageLayerOptionsProgramsModule();
        await prewarmLayerBlendTilePrograms(session.device, "rgba16float");
        return { format: "rgba16float", programCount: 9 };
      },
    },
    {
      id: "transform-programs",
      async run({ session }) {
        const { prewarmRasterTransformProgramsForDevice } =
          await stageTransformProgramsModule();
        await prewarmRasterTransformProgramsForDevice(
          session.device,
          "rgba16float",
        );
        return {
          format: "rgba16float",
          targets: ["affine", "deform", "selection"],
        };
      },
    },
  ];
  return createHomeEditorWarmupController({
    enabled: options.enabled,
    preGpuTasks,
    tasks,
    browser,
    document: options.document,
  });
}
