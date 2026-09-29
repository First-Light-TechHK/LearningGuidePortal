export async function cookies() {
  return {
    get() { return undefined; },
    getAll() { return []; },
    has() { return false; },
    set() {},
    delete() {},
  };
}

export async function headers() {
  return new Headers();
}
