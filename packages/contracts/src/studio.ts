import * as Schema from "effect/Schema";

export const StudioArea = Schema.Literals([
  "design",
  "photo",
  "story",
  "motion",
  "live",
  "recordings",
]);
export type StudioArea = typeof StudioArea.Type;
export const StudioId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);
export const StudioReadInput = Schema.Struct({
  scope: Schema.Literals(["studio", "artwork", "live", "capabilities", "recordings"]),
  id: Schema.optional(StudioId),
});
export type StudioReadInput = typeof StudioReadInput.Type;
export const StudioSnapshot = Schema.Struct({
  available: Schema.Boolean,
  message: Schema.NullOr(Schema.String),
  data: Schema.Json,
  svg: Schema.NullOr(Schema.String),
});
export type StudioSnapshot = typeof StudioSnapshot.Type;
export const StudioMutationInput = Schema.Struct({
  operation: Schema.Literals([
    "create",
    "artwork",
    "studio",
    "live",
    "pin",
    "motion_from_story",
    "photo_crop",
    "import_audio",
    "recording_transcribe",
    "recording_edit",
    "recording_archive",
    "recording_restore",
    "recording_cancel",
  ]),
  area: Schema.optional(StudioArea),
  id: Schema.optional(StudioId),
  name: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  requestId: StudioId,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  payload: Schema.Json,
});
export type StudioMutationInput = typeof StudioMutationInput.Type;
export const StudioExportInput = Schema.Struct({
  kind: Schema.Literals([
    "svg",
    "png",
    "outlined_svg",
    "story",
    "motion",
    "live",
    "motion_frame",
    "recording",
  ]),
  id: Schema.optional(StudioId),
  layerId: Schema.optional(StudioId),
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  frame: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 14_400 }))),
  delivery: Schema.optional(Schema.Literals(["base64", "stream"])),
});
export type StudioExportInput = typeof StudioExportInput.Type;
export const StudioExportResult = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({ name: Schema.String, mimeType: Schema.String, base64: Schema.String }),
  ),
  downloads: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        mimeType: Schema.String,
        attachmentId: Schema.String,
        bytes: Schema.Number,
      }),
    ),
  ),
});
export type StudioExportResult = typeof StudioExportResult.Type;
export class StudioError extends Schema.TaggedError<StudioError>()("StudioError", {
  detail: Schema.String,
}) {
  override get message() {
    return this.detail;
  }
}
