import { randomInt } from "node:crypto";

const firstWords = ["Amber", "Bright", "Cedar", "Clear", "Kind", "Lucky", "River", "Willow"];
const secondWords = ["Bridge", "Clover", "Harbor", "Lantern", "Meadow", "Orbit", "Pine", "Sunrise"];

export function createMeetingCode() {
  return `${firstWords[randomInt(firstWords.length)]} ${secondWords[randomInt(secondWords.length)]}`;
}