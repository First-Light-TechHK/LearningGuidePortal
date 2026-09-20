import type { ProductData } from "../../services/productStore";

export type DataChange = {
  action: "add" | "update" | "skip";
  kind: string;
  id: string;
  reason?: string;
};

export type DataMigration = {
  id: string;
  description: string;
  apply: (data: ProductData) => DataChange[];
};
