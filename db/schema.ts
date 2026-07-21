/** The one immutable cross-device benchmark selected by the first recording. */
export interface HumanStrokeBenchmarkRecord {
  id: "canonical";
  payloadJson: string;
  capturedAt: string;
}

export const humanStrokeBenchmarkSchemaSql = `
CREATE TABLE IF NOT EXISTS human_stroke_benchmark (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'canonical'),
  payload_json TEXT NOT NULL,
  captured_at TEXT NOT NULL
)
`;
