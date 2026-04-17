/**
 * Parse a remnant-writing route's request body, supporting both JSON
 * (legacy: image embedded as a base64 data URL) and multipart/form-data
 * (preferred: image attached as a File, body JSON in a "data" part).
 *
 * Returns the body with image_file set to a File when multipart was used,
 * or the legacy {name, type, dataUrl} shape when JSON was used.
 */
export async function parseRemnantRequestBody(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();

  if (contentType.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const dataField = form.get("data");
    const body = typeof dataField === "string" && dataField.length
      ? JSON.parse(dataField)
      : {};
    const image = form.get("image");
    if (image && typeof image !== "string") {
      body.image_file = image;
    }
    return body;
  }

  return request.json();
}
