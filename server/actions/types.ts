import type { ObjectTypeName } from "../../shared/schema.js";
import type { Clusterer } from "../clustering/types.js";
import type { Queryable } from "../db/client.js";

export type ParamType =
  | "string"
  | "integer"
  | "double"
  | "boolean"
  | "timestamp"
  | "string[]"
  | { object: ObjectTypeName };

export interface ParamDef {
  type: ParamType;
  nullable?: boolean;
}

export interface ActionContext {
  tx: Queryable;
  now: Date;
  user: string;
  newId(prefix: string): string;
  /** Injected by tests and the seed; otherwise chosen by applyAction for actions with needsClusterer. */
  clusterer?: Clusterer;
}

export interface ActionResult {
  created?: string[];
  modified?: string[];
  /** Human-readable context for the UI (e.g. which clusterer proposed rules). */
  note?: string;
}

export interface ActionDef<P> {
  params: { [K in keyof P]-?: ParamDef };
  run(ctx: ActionContext, params: P): Promise<ActionResult>;
  /**
   * The action clusters rejections. applyAction chooses the clusterer on the
   * root connection before the transaction opens, so the Claude cost-guard
   * claim commits on its own and survives a rollback of the action.
   */
  needsClusterer?: boolean;
}

export function defineAction<P>(def: ActionDef<P>): ActionDef<P> {
  return def;
}
