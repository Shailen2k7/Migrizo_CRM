'use client';

import { TasksView } from '@/components/tasks/tasks-view';

export default function TasksPage() {
  return (
    <div className="max-w-[1480px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-7 pb-10">
      <TasksView />
    </div>
  );
}
