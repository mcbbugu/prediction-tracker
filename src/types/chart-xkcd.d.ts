// chart.xkcd ships no types; we only use the XY chart.
declare module "chart.xkcd" {
  const chartXkcd: { XY: new (svg: SVGSVGElement, config: unknown) => unknown };
  export default chartXkcd;
}
