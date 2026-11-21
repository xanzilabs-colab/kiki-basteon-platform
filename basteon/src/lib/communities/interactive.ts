import { z } from "zod";
import { evaluateInteractiveCommunityText } from "./guardrails";

const typeSchema = z.enum([
  "post", "carousel", "poll", "tt", "slider", "fill", "cap", "hot", "quiz", "mf", "hunt", "chal", "ama", "decide", "path",
]);

const optionSchema = z.object({
  label: z.string().trim().min(1).max(90),
  subLabel: z.string().trim().max(60).optional().default(""),
  correct: z.boolean().optional().default(false),
});

const mediaSchema = z.object({
  storagePath: z.string().min(1).max(300),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
  caption: z.string().trim().max(120).optional().default(""),
  altText: z.string().trim().max(200).optional().default(""),
});

const pathChoiceSchema = z.object({
  text: z.string().trim().min(1).max(90),
  to: z.string().trim().min(1).max(32),
  tip: z.string().trim().max(140).optional().default(""),
});

const pathNodeSchema = z.object({
  id: z.string().trim().min(1).max(32),
  text: z.string().trim().min(1).max(180),
  mediaIndex: z.number().int().min(0).optional(),
  choices: z.array(pathChoiceSchema).max(2).optional(),
  end: z.boolean().optional().default(false),
});

export const interactivePostSchema = z.object({
  id: z.string().uuid(),
  communityId: z.string().uuid(),
  type: typeSchema,
  title: z.string().trim().max(160).optional().default(""),
  body: z.string().trim().max(600).optional().default(""),
  options: z.array(optionSchema).max(4).optional().default([]),
  media: z.array(mediaSchema).max(10).optional().default([]),
  targets: z.array(z.object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    label: z.string().trim().min(1).max(60),
  })).max(5).optional().default([]),
  config: z.object({
    lo: z.string().trim().max(60).optional().default(""),
    hi: z.string().trim().max(60).optional().default(""),
    prefix: z.string().trim().max(160).optional().default(""),
    suffix: z.string().trim().max(160).optional().default(""),
    hitRadius: z.number().min(4).max(18).optional().default(8),
    days: z.number().int().min(1).max(7).optional().default(7),
    nodes: z.array(pathNodeSchema).max(7).optional().default([]),
  }).optional().default({}),
  explanation: z.string().trim().max(280).optional().default(""),
  correctPosition: z.number().int().min(0).max(3).optional(),
  truth: z.enum(["Myth", "Fact"]).optional(),
  parentAttemptPostId: z.string().uuid().optional(),
});

export type InteractivePostInput = z.infer<typeof interactivePostSchema>;

export function interactivePostError(input: InteractivePostInput) {
  const { type, title, body, options, media, targets, config } = input;
  if (type === "post") {
    if (!body) return "A text post needs a message.";
    if (title) return "Text posts use the message as their headline.";
  } else if (!title) {
    return "Add a headline or question for this post.";
  }
  if (type === "carousel" && media.length < 1) return "Add at least one image to the carousel.";
  if (type === "cap" && media.length !== 1) return "Caption contests need exactly one image.";
  if (type === "hunt" && (media.length !== 1 || targets.length < 1)) return "Spot it posts need one image and at least one labelled target.";
  if (type !== "hunt" && targets.length) return "Targets can only be added to Spot it posts.";
  if (type === "poll" || type === "decide") {
    if (options.length < 2 || options.length > 4) return "Add between two and four choices.";
  }
  if (type === "tt" && options.length !== 2) return "This-or-that needs exactly two choices.";
  if (type === "quiz" && (options.length < 2 || options.length > 4 || options.filter((option) => option.correct).length !== 1)) {
    return "A quiz needs two to four choices and exactly one correct answer.";
  }
  if (type === "mf" && !input.truth) return "Choose whether the claim is a myth or a fact.";
  if (type === "fill" && !config.prefix) return "Add the words before the blank.";
  if (type === "path" && !isValidPath(config.nodes, media.length)) return "Your path needs two to seven connected steps, with two choices at each decision.";
  return "";
}

function isValidPath(nodes: InteractivePostInput["config"]["nodes"], mediaCount: number) {
  if (nodes.length < 2 || nodes.length > 7) return false;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) return false;
  for (const node of nodes) {
    if (node.mediaIndex !== undefined && node.mediaIndex >= mediaCount) return false;
    if (node.end ? (node.choices?.length ?? 0) > 0 : node.choices?.length !== 2) return false;
    if (node.choices?.some((choice) => !byId.has(choice.to))) return false;
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  function visit(id: string, depth: number): boolean {
    if (depth > 4 || active.has(id)) return false;
    if (visited.has(id)) return true;
    const node = byId.get(id);
    if (!node) return false;
    active.add(id);
    visited.add(id);
    const valid = node.end || (node.choices ?? []).every((choice) => visit(choice.to, depth + 1));
    active.delete(id);
    return valid;
  }
  return visit(nodes[0].id, 0) && visited.size === nodes.length;
}

export function guardInteractivePost(input: InteractivePostInput, realName: string) {
  const copy: InteractivePostInput = structuredClone(input);
  const removed = new Set<string>();
  let refusal = "";
  const guard = (value: string) => {
    const result = evaluateInteractiveCommunityText(value, realName);
    result.removed.forEach((item) => removed.add(item));
    if (result.decision === "refuse") refusal = result.reason;
    return result.safeText;
  };

  if (copy.title) copy.title = guard(copy.title);
  if (copy.body) copy.body = guard(copy.body);
  copy.options = copy.options.map((option) => ({
    ...option,
    label: guard(option.label),
    subLabel: option.subLabel ? guard(option.subLabel) : "",
  }));
  copy.media = copy.media.map((image) => ({
    ...image,
    caption: image.caption ? guard(image.caption) : "",
    altText: image.altText ? guard(image.altText) : "",
  }));
  copy.targets = copy.targets.map((target) => ({ ...target, label: guard(target.label) }));
  if (copy.explanation) copy.explanation = guard(copy.explanation);
  copy.config = {
    ...copy.config,
    lo: copy.config.lo ? guard(copy.config.lo) : "",
    hi: copy.config.hi ? guard(copy.config.hi) : "",
    prefix: copy.config.prefix ? guard(copy.config.prefix) : "",
    suffix: copy.config.suffix ? guard(copy.config.suffix) : "",
    nodes: copy.config.nodes.map((node) => ({
      ...node,
      text: guard(node.text),
      choices: node.choices?.map((choice) => ({
        ...choice,
        text: guard(choice.text),
        tip: choice.tip ? guard(choice.tip) : "",
      })),
    })),
  };
  return { input: copy, removed: [...removed], refusal };
}

