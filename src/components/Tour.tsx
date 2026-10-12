import { useEffect, useState, type ReactNode } from 'react';

type View = 'day' | 'week' | 'month' | 'progress' | 'admin' | 'settings';

interface Step {
  /** The screen shown behind the card while this step is open. */
  view: View;
  icon: string;
  title: string;
  points: ReactNode[];
}

const steps = (name: string, admin: boolean): Step[] => [
  {
    view: 'day',
    icon: 'waving_hand',
    title: `Welcome to LockedIn, ${name}`,
    points: [
      'LockedIn keeps your day, your week and your month in one calm place.',
      'This short tour shows you every tool. It takes about a minute, and you can replay it anytime from Settings.',
    ],
  },
  {
    view: 'day',
    icon: 'view_day',
    title: 'Your day is a timeline',
    points: [
      'Every task is a colored block on the timeline. Taller blocks take longer.',
      <>Tap the <strong>circle</strong> on the right of a task to tick it off. The bar at the top shows how much of the day is done.</>,
      'Gaps of 30 minutes or more show up as free time, so you can see where your day has room.',
    ],
  },
  {
    view: 'day',
    icon: 'add_circle',
    title: 'Add a task with +',
    points: [
      <>Tap the green <strong>+</strong> button in the corner.</>,
      'Name it, pick an icon, then set the date and when it starts and ends. A task can be as long as you need, up to midnight.',
      <>Choose a color, and whether it <strong>repeats</strong>: once, every day, every week or every month.</>,
    ],
  },
  {
    view: 'day',
    icon: 'touch_app',
    title: 'Change anything, anytime',
    points: [
      'Tap any task to edit it, move it to another time, or delete it.',
      <>Repeating tasks carry a small <strong>Daily</strong>, <strong>Weekly</strong> or <strong>Monthly</strong> tag.</>,
      <>Use the <strong>arrows</strong> at the top to move through your calendar, <strong>Today</strong> to jump back, and the row of dates to open any day this week.</>,
    ],
  },
  {
    view: 'week',
    icon: 'calendar_view_week',
    title: 'See your whole week',
    points: [
      'Every day’s tasks sit side by side, so you can spot busy and quiet days at a glance. Tap a day to open it.',
      <><strong>Weekly goals</strong> are for things to get done sometime this week, like “call mom”. Add them at the bottom and tick them off.</>,
      <>Tap a goal to <strong>link it to your daily tasks</strong>. Say “Gym 4 times”: every gym session you tick counts, and the goal ticks itself at 4. Set it to repeat every week.</>,
    ],
  },
  {
    view: 'month',
    icon: 'calendar_month',
    title: 'Plan the month',
    points: [
      'Each colored dot is a task on that day. Tap any day to open it.',
      <><strong>Monthly goals</strong> hold the bigger things, like paying rent or booking the dentist. They can count daily tasks too, or the weeks you met a weekly goal.</>,
      <>Switch between <strong>Day</strong>, <strong>Week</strong> and <strong>Month</strong> with the tabs at the top or the menu.</>,
    ],
  },
  {
    view: 'progress',
    icon: 'local_fire_department',
    title: 'Build streaks, watch yourself improve',
    points: [
      <>Repeating tasks build <strong>streaks</strong>: “🔥 6 days” means six in a row. Don’t break the chain!</>,
      <><strong>Progress</strong> shows how your week is going, the last 8 weeks, every habit’s streak and best run, and your goals.</>,
    ],
  },
  {
    view: 'day',
    icon: 'notifications_active',
    title: 'Install it and get reminders',
    points: [
      <><strong>Install</strong> LockedIn on your home screen so it opens like a regular app. On iPhone: Share, then “Add to Home Screen”.</>,
      <>Turn on <strong>reminders</strong> and you’ll get a notification the moment each task starts, even when the app is closed.</>,
      <>Tap <strong>Done</strong> on a reminder to tick the task off right from your lock screen, or <strong>Remind me in 10 min</strong>. Each task can also remind you 5 to 60 minutes early.</>,
      <>A <strong>morning briefing</strong> before your first task, <strong>one check-in</strong> in the evening if something’s unticked, and a <strong>Sunday review</strong> of your week. Pick what you get in Settings.</>,
      'The card at the top of your planner walks you through both.',
    ],
  },
  {
    view: 'settings',
    icon: 'settings',
    title: 'Settings',
    points: [
      'Change your name, install the app, and turn reminders on or off. You can also send yourself a test notification.',
      <>Want this tour again? Tap <strong>Replay tutorial</strong> here.</>,
    ],
  },
  ...(admin
    ? [{
        view: 'admin' as const,
        icon: 'admin_panel_settings',
        title: 'Your admin panel',
        points: [
          'See every customer with when they joined, when they last opened the app, and how much they’ve planned.',
          'Open a customer to see their details and a read-only view of their plan. From there you can change their role, suspend them or delete them.',
          <>Download everyone as a <strong>CSV</strong>, and send a notification to one customer or to everyone with reminders on.</>,
        ],
      }]
    : []),
  {
    view: 'day',
    icon: 'rocket_launch',
    title: 'You’re all set',
    points: ['Start with one task you want to do today. Small plans you keep beat big plans you skip.'],
  },
];

interface Props {
  name: string;
  admin: boolean;
  isWide: boolean;
  setView: (v: View) => void;
  onDone: (addTask: boolean) => void;
}

export function Tour({ name, admin, isWide, setView, onDone }: Props) {
  const list = steps(name.split(' ')[0] || name, admin);
  const [i, setI] = useState(0);
  const step = list[i], last = i === list.length - 1;

  useEffect(() => {
    setView(step.view);
  }, [step.view, setView]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone(false);
      if (e.key === 'ArrowRight' && !last) setI((n) => n + 1);
      if (e.key === 'ArrowLeft' && i > 0) setI((n) => n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, last, onDone]);

  return (
    <div className="tour-scrim" style={{ alignItems: isWide ? 'center' : 'flex-end' }}>
      <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" style={{ borderRadius: isWide ? 24 : '24px 24px 0 0' }}>
        <div className="tour-top">
          <div className="tour-icon"><span className="ms">{step.icon}</span></div>
          {!last && <button className="nudge-later" onClick={() => onDone(false)}>Skip tour</button>}
        </div>
        <div className="tour-count">Step {i + 1} of {list.length}</div>
        <h2 id="tour-title" className="tour-title">{step.title}</h2>
        <ul className="tour-points">
          {step.points.map((p, k) => <li key={k}>{p}</li>)}
        </ul>
        <div className="tour-dots" aria-hidden="true">
          {list.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}
        </div>
        <div className="tour-actions">
          {i > 0 && <button className="btn-outline tour-back" onClick={() => setI(i - 1)}>Back</button>}
          {last ? (
            <>
              <button className="btn-outline tour-back" onClick={() => onDone(false)}>Start planning</button>
              <button className="btn-accent tour-next" onClick={() => onDone(true)}>Add my first task</button>
            </>
          ) : (
            <button className="btn-accent tour-next" onClick={() => setI(i + 1)} autoFocus>{i === 0 ? 'Show me around' : 'Next'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
