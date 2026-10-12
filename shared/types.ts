export type Role = 'user' | 'admin';
export type Status = 'active' | 'suspended';
export type TaskKind = 'timed' | 'week' | 'month';
export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: Status;
  created: number;
  /** Whether they have finished or skipped the first-login tutorial. */
  onboarded: boolean;
  /** Which notifications they want. */
  prefs: NotifyPrefs;
}

/** HH:MM times are in the user's own time zone. */
export interface NotifyPrefs {
  /** Reminders for individual tasks (each task also picks when, or off). */
  tasks: boolean;
  /** One evening check-in when something is left unticked. */
  checkin: boolean;
  /** Morning briefing: off, 30 minutes before the first task, or at a set time. */
  morning: 'off' | 'auto' | string;
  /** Sunday weekly review: off, or a time on Sunday. */
  review: 'off' | string;
}

export const DEFAULT_PREFS: NotifyPrefs = { tasks: true, checkin: true, morning: 'auto', review: '19:00' };
/** In 'auto' mode the morning briefing goes out this long before the day's first task. */
export const MORNING_LEAD_MIN = 30;

export interface AdminUser extends User {
  /** Timed tasks on their timeline. */
  taskCount: number;
  /** Weekly and monthly goals. */
  goalCount: number;
  /** Last time they opened the app, or null if never. */
  lastActive: number | null;
  /** Devices with reminders turned on. */
  devices: number;
}

export interface NotifyResult {
  people: number;
  devices: number;
}

export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  newThisWeek: number;
  totalTasks: number;
}

/** A timed task on the day timeline, or a weekly/monthly goal. Timed-only fields are null for goals. */
export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  /** YYYY-MM-DD — first occurrence for timed tasks, the day a goal was added for goals. */
  date: string;
  /** HH:MM */
  start: string | null;
  /** Minutes */
  dur: number | null;
  color: number | null;
  icon: string | null;
  /** Timed tasks: once/daily/weekly/monthly. Goals: 'none', or 'weekly'/'monthly' for a goal that comes back every period. */
  repeat: Repeat | null;
  /** Timed tasks: minutes before the start to send the reminder (0 = at the start, -1 = no reminder). */
  remind: number | null;
  /** Goals only: how many ticks of the linked tasks complete the goal (e.g. 4 gym sessions a week). */
  target: number | null;
  /** Goals only: ids of the daily tasks (or, for monthly goals, weekly goals) whose ticks count toward the target. */
  links: string[];
  /** Completion per occurrence: day (YYYY-MM-DD), week start (YYYY-MM-DD) or month (YYYY-MM). */
  done: Record<string, boolean>;
}

export interface TimedTaskInput {
  title: string;
  date: string;
  start: string;
  dur: number;
  color: number;
  icon: string;
  repeat: Repeat;
  remind: number;
}

export const ICONS = ['alarm', 'self_improvement', 'shower', 'directions_bike', 'coffee', 'mail', 'edit', 'groups', 'work', 'menu_book', 'restaurant', 'fitness_center', 'directions_run', 'shopping_cart', 'water_drop', 'favorite', 'call', 'bedtime'];
export interface GoalInput {
  title: string;
  repeat: 'none' | 'weekly' | 'monthly';
  target: number | null;
  links: string[];
}

/** Longest task: a whole day. Tasks end by midnight; the server also checks start + length. */
export const MAX_DUR = 1440;
export const MAX_TARGET = 99;
/** Reminder choices for a task: off, at the start, or minutes before. */
export const REMIND_OPTIONS = [-1, 0, 5, 10, 15, 30, 60];
export const MAX_LINKS = 20;
export const COLOR_COUNT = 8;
export const REPEATS: Repeat[] = ['none', 'daily', 'weekly', 'monthly'];
