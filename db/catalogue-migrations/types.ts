export type CatalogueChange = {
  action: "add" | "skip";
  kind: "course" | "portalContent";
  id: string;
  reason?: string;
};

export type CatalogueMigration = {
  id: string;
  description: string;
  apply: (data: { courses: Array<{ id: string; slug: string }> }) => CatalogueChange[];
};
