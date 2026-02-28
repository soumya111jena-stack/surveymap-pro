export function haversine(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const sin2 =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) *
      Math.cos(toRad(b[0])) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sin2));
}

function convertDist(meters, unit) {
  switch (unit) {
    case "km":
      return [meters / 1000, "km"];
    case "m":
      return [meters, "m"];
    case "cm":
      return [meters * 100, "cm"];
    case "mi":
      return [meters / 1609.344, "mi"];
    case "yd":
      return [meters / 0.9144, "yd"];
    case "ft":
      return [meters / 0.3048, "ft"];
    case "nmi":
      return [meters / 1852, "nmi"];
    default:
      return meters >= 1000 ? [meters / 1000, "km"] : [meters, "m"];
  }
}

export function formatDist(meters, unit) {
  const [val, u] = convertDist(meters, unit);
  return `${val >= 100 ? val.toFixed(1) : val.toFixed(2)} ${u}`;
}

