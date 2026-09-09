export {};

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error("usage: auth-05-worker <email> <password>");
    process.exit(2);
  }
  if (process.env.AUTH05_CWD) process.chdir(process.env.AUTH05_CWD);
  process.env.STORAGE_BACKEND = "local";
  const store = await import("../../../services/productStore");
  const user = await store.registerUser({ email, password, nickname: "Auth Five" });
  process.stdout.write(JSON.stringify({ id: user.id, email: user.email }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
