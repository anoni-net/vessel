// Which day of a device inspection it is, shared by the inspection's page and the device card on the devices page, so
// the two count the same day. Kept apart from pages/inspect.tsx, which the devices page loads only when it is opened.

/** Which day of the inspection it is, on the visitor's clock: the third of seven. */
export function progress(state: { ends_at?: string | null; days: number }) {
  const left = Math.ceil((new Date(state.ends_at!).getTime() - Date.now()) / 86_400_000);
  return { day: Math.min(state.days, Math.max(1, state.days - left + 1)), days: state.days };
}
