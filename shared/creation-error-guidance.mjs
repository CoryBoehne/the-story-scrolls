export const IMAGE_SAFETY_REVISION_REQUIRED_MESSAGE =
  "An image safety check could not approve one or more illustration requests. This is not a judgment about your story. Revise the visual direction or character/reference descriptions, then prepare and approve a new visual guide before trying again. No automatic retry was made.";

export function creatorFacingCreationError(error, fallback = "The scroll could not be created.") {
  if (error?.code === "IMAGE_SAFETY_REVISION_REQUIRED") {
    return IMAGE_SAFETY_REVISION_REQUIRED_MESSAGE;
  }
  return typeof error?.message === "string" && error.message.trim()
    ? error.message
    : fallback;
}
