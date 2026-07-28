declare module "opentype.js" {
  const opentype: {
    parse(buffer: ArrayBuffer): unknown;
  };
  export default opentype;
}
