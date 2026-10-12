export function describeTriggerPattern(pattern: string | null | undefined) {
  switch (pattern) {
    case "3-2": return "Medical rhythm (3 quick presses, pause, 2)";
    case "2-2-2": return "Duress rhythm (2 quick presses, pause, 2, pause, 2)";
    case "4": return "Cancel rhythm (4 quick presses)";
    case "5": return "SOS rhythm (5 quick presses)";
    default:
      if (!pattern) return null;
      if (/^5+$/.test(pattern)) return "SOS rhythm (5 or more quick presses)";
      return `Media-button sequence ${pattern}`;
  }
}
