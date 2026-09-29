export type PortalLibraryItem = {
  id: string;
  fileName: string;
  url: string;
  kind: "bundled" | "uploaded";
  contentType?: "image/jpeg" | "image/png" | "image/webp";
};
