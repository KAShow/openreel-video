/**
 * What one AI-assistant request cost on Director's Eyes points: the number of model calls the
 * editor-ai function charged (steps) times the per-call price (director_prices.editor_ai_call).
 * The server's reply carries no charged amount or balance, so the points are computed here.
 * Kept free of React and the Supabase session so chat-store can use it directly.
 */
import { msg } from "./i18n/messages";

export const DEFAULT_STEP_PRICE = 0.1;
let stepPrice: number | null = null;

/** Price of one model call, as loaded by AIPriceNote; the default until it has loaded. */
export function getStepPrice(): number {
  return stepPrice ?? DEFAULT_STEP_PRICE;
}

/** True once the admin-set price has been loaded (AIPriceNote loads it once per page). */
export function hasLoadedStepPrice(): boolean {
  return stepPrice !== null;
}

export function setStepPrice(points: number): void {
  if (Number.isFinite(points) && points >= 0) stepPrice = points;
}

export interface ChatTurnCost {
  /** Model calls the server charged for this request. */
  readonly steps: number;
  /** Points those calls cost. */
  readonly points: number;
}

/** Cost of `steps` charged calls at `price` each, without float noise (3 × 0.1 → 0.3). */
export function turnCost(steps: number, price: number = getStepPrice()): ChatTurnCost {
  return { steps, points: Number((steps * price).toFixed(2)) };
}

/** Arabic count of steps: خطوة واحدة / خطوتان / 3 خطوات / 11 خطوة. */
export function stepsLabel(n: number): string {
  if (n === 1) return msg("chat.cost.steps.one");
  if (n === 2) return msg("chat.cost.steps.two");
  const lastTwo = n % 100;
  return msg(lastTwo >= 3 && lastTwo <= 10 ? "chat.cost.steps.few" : "chat.cost.steps.many", { n });
}

/** "استهلك هذا الطلب 0.3 نقطة (3 خطوات)" — starts with an Arabic word so it lays out right-to-left. */
export function costLabel(cost: ChatTurnCost): string {
  return msg("chat.cost.line", { points: Number(cost.points.toFixed(2)), steps: stepsLabel(cost.steps) });
}
