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
}

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
  repeat: Repeat | null;
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
}

export const ICONS = ['alarm', 'self_improvement', 'shower', 'directions_bike', 'coffee', 'mail', 'edit', 'groups', 'work', 'menu_book', 'restaurant', 'fitness_center', 'directions_run', 'shopping_cart', 'water_drop', 'favorite', 'call', 'bedtime'];
export const DURATIONS = [15, 30, 45, 60, 90, 120];
export const COLOR_COUNT = 8;
export const REPEATS: Repeat[] = ['none', 'daily', 'weekly', 'monthly'];
