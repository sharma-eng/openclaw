// Classifies Canvas items on the Eisenhower matrix and formats them for Jarvis.
import type {
  CanvasAnnouncement,
  CanvasAssignment,
  CanvasCourse,
  SurfacedItem,
  UrgencyQuadrant,
} from "./types.js";

/** Returns hours until the given ISO date string, or Infinity if null. */
function hoursUntil(isoDate: string | null): number {
  if (!isoDate) return Infinity;
  return (new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60);
}

/** Strips HTML tags from Canvas announcement message bodies. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function classifyAssignment(
  assignment: CanvasAssignment,
  course: CanvasCourse,
  warningHours: number,
): SurfacedItem | null {
  const hours = hoursUntil(assignment.due_at);

  // No due date — not urgent, but important to be aware of.
  if (!isFinite(hours)) {
    return {
      quadrant: "Q2",
      title: `${course.course_code}: ${assignment.name}`,
      detail: `No due date. ${assignment.points_possible ? `Worth ${assignment.points_possible} pts.` : ""}`,
      url: assignment.html_url,
      dueAt: null,
      source: "assignment",
    };
  }

  // Past due — drop, already missed.
  if (hours < 0) return null;

  let quadrant: UrgencyQuadrant;
  if (hours <= warningHours) {
    quadrant = "Q1"; // Urgent + important
  } else if (hours <= warningHours * 3) {
    quadrant = "Q2"; // Coming up but not urgent yet
  } else {
    quadrant = "Q4"; // Far out — don't surface
  }

  if (quadrant === "Q4") return null;

  const dueDate = new Date(assignment.due_at!);
  const dueStr = dueDate.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return {
    quadrant,
    title: `${course.course_code}: ${assignment.name}`,
    detail: `Due ${dueStr} (${Math.round(hours)}h away).${assignment.points_possible ? ` Worth ${assignment.points_possible} pts.` : ""}`,
    url: assignment.html_url,
    dueAt: dueDate,
    source: "assignment",
  };
}

export function classifyAnnouncement(
  announcement: CanvasAnnouncement,
  course: CanvasCourse,
): SurfacedItem {
  const postedHoursAgo =
    (Date.now() - new Date(announcement.posted_at).getTime()) / (1000 * 60 * 60);
  // Recent announcements (< 6h) are Q1; older ones are Q3 (read but don't block CEO).
  const quadrant: UrgencyQuadrant = postedHoursAgo < 6 ? "Q1" : "Q3";

  return {
    quadrant,
    title: `${course.course_code} announcement: ${announcement.title}`,
    detail: stripHtml(announcement.message),
    url: announcement.html_url,
    dueAt: null,
    source: "announcement",
  };
}

/** Formats surfaced items as a Jarvis-style briefing string. */
export function formatBriefing(items: SurfacedItem[], courseName?: string): string {
  const q1 = items.filter((i) => i.quadrant === "Q1");
  const q2 = items.filter((i) => i.quadrant === "Q2");
  const lines: string[] = [];

  if (courseName) lines.push(`**Canvas update — ${courseName}**`);

  if (q1.length > 0) {
    lines.push("\n🔴 Needs attention now:");
    for (const item of q1) {
      lines.push(`  • ${item.title} — ${item.detail}`);
    }
  }

  if (q2.length > 0) {
    lines.push("\n🟡 Coming up:");
    for (const item of q2) {
      lines.push(`  • ${item.title} — ${item.detail}`);
    }
  }

  return lines.join("\n");
}
