export {};

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("usage: arch-01-worker <email>");
    process.exit(2);
  }
  if (process.env.ARCH01_CWD) process.chdir(process.env.ARCH01_CWD);
  process.env.STORAGE_BACKEND = "local";
  const store = await import("../../../services/productStore");
  const user = await store.registerUser({ email, password: "password1", nickname: "Arch One" });
  process.stdout.write(JSON.stringify({ id: user.id, email: user.email }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
