import Image from "next/image";

export function AuthBrand({ name }: { name: string }) {
  return <span className="portal-brand-lockup"><Image src="/portal/figma-logo.svg" width={40} height={40} alt="" /><strong>{name}</strong></span>;
}
