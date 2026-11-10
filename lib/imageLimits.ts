// Shared by browser validation and server reads. Leave room for multipart
// headers below Vercel's 4.5 MB function request/response limit.
export const maxImageBytes = 4 * 1024 * 1024;

// Existing uploads used a 5 MiB limit. Retain bounded reads of those records.
export const maxStoredImageBytes = 5 * 1024 * 1024;
