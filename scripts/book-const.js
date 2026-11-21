export const MOD = "nachtmark";

let content = null;
export async function getContent() {
  content ??= await (await fetch(`modules/${MOD}/data/book.json`)).json();
  return content;
}
export function getState() {
  const st = foundry.utils.deepClone(game.settings.get(MOD, "book") ?? {});
  st.q ??= {}; st.o ??= {}; st.e ??= {};
  return st;
}
export async function saveState(st) {
  if (!game.user.isGM) return;
  await game.settings.set(MOD, "book", st);
}
