from django.utils import timezone
from typing import List
from datetime import datetime
from tasks.models import Task

def calculate_dynamic_score(task: Task, now: datetime) -> float:
    # Score=(Wp * Priority) + (Wd / HoursUntilDeadline)
    wp = 1.0
    wd = 10.0
    
    score = wp * task.priority
    
    if task.latest_finish_date:
        time_until_deadline = task.latest_finish_date - now
        hours_until = time_until_deadline.total_seconds() / 3600.0
        if hours_until > 0:
            score += wd / hours_until
        else:
            score += wd * 100  # overdue gets huge score boost
            
    return score

def rank_tasks(tasks: List[Task], now: datetime) -> List[Task]:
    # Hard Constraints (Deadlines): Tasks are first sorted by latest_finish_date.
    # Soft Constraints (Priority): Within the same deadline window, task.priority determines order.
    
    def sort_key(t):
        deadline = t.latest_finish_date
        if not deadline:
             # Put tasks without deadline at the end
            deadline = datetime.max.replace(tzinfo=timezone.get_current_timezone())
            
        return (deadline, -t.priority)
        
    return sorted(tasks, key=sort_key)


class PlanItem:
    def __init__(self, task, start_time, duration):
        self.task = task
        self.start_time = start_time
        self.duration = duration
        self.warnings = []
        
        # Check deadline
        if task.latest_finish_date:
            finish_time = start_time + duration
            if finish_time > task.latest_finish_date:
                self.warnings.append("Deadline exceeded")
        
    def __repr__(self):
        return f"<PlanItem: {self.task.header} at {self.start_time}>"


def allocate_tasks(buckets: List['TimeBucket'], tasks: List[Task]) -> dict:
    # tasks should be already ranked
    # Returns mapping { bucket_id: [PlanItem] }
    
    plan = {}
    
    # We need a copy of tasks to track remaining duration (or just update objects if persistent)
    # For now, simplistic bin packing assuming tasks fit wholly or partially.
    
    remaining_tasks = list(tasks)
    last_task = None
    
    MIN_TASK_SLICE = timezone.timedelta(minutes=15)
    
    for bucket in sorted(buckets, key=lambda b: b.start_date):
        bucket_plan = []
        current_time = bucket.start_date
        bucket_end = bucket.end_date
        
        # Filter Logic: Affinity
        bucket_tags = set(bucket.type.tags.all())
        has_affinity = len(bucket_tags) > 0
        
        # Stickiness: Check if last_task is compatible and unfinished
        # (In this simple model, last_task is just the last one we touched. 
        #  We need to knwow if it's unfinished. Our list manipulation implies if it's in remaining, it's unfinished.)
        
        tasks_to_consider = remaining_tasks
        remaining_tasks = []
        
        # Move stickiness task to front if compatible
        if last_task and last_task in tasks_to_consider:
             # Check affinity for last_task
             is_compatible = True
             if has_affinity:
                 last_tags = set(last_task.tags.all())
                 if not bucket_tags.intersection(last_tags):
                     is_compatible = False
             
             if is_compatible:
                 tasks_to_consider.remove(last_task)
                 tasks_to_consider.insert(0, last_task)
        
        idx = 0
        while idx < len(tasks_to_consider):
            task = tasks_to_consider[idx]
            
            # Affinity Check
            if has_affinity:
                task_tags = set(task.tags.all())
                if not bucket_tags.intersection(task_tags):
                    remaining_tasks.append(task)
                    idx += 1
                    continue
            
            # Check space
            remaining_duration = bucket_end - current_time
            if remaining_duration.total_seconds() <= 0:
                remaining_tasks.append(task)
                idx += 1
                continue
            
            # Min Quantum Check
            # "Do not schedule a task into the remaining space of a bucket if the space < 15 mins (unless the task finishes in that time)."
            task_dur = task.duration if task.duration else timezone.timedelta(hours=1)
            
            if remaining_duration < MIN_TASK_SLICE and task_dur > remaining_duration:
                # Skip scheduling in this bucket
                # But we might try next task? Requirement says "Do not schedule a task..." 
                # implying the bucket space is wasted or strictly for finishing tasks.
                # We'll skip this task.
                remaining_tasks.append(task)
                idx += 1
                continue

            # Schedule
            to_schedule = min(task_dur, remaining_duration)
            
            bucket_plan.append(PlanItem(task, current_time, to_schedule))
            current_time += to_schedule
            last_task = task
            
            if to_schedule < task_dur:
                # Task not finished. We need to update its duration in our transient list
                # Since we can't easily modify the object in the list safely without affecting the original references if we re-use them...
                # actually for the test we can just mutate the task object's duration locally if we don't save.
                # But `task` is a Django model.
                # We'll make a copy or just mutate it for this session.
                task.duration -= to_schedule
                remaining_tasks.append(task) 
            else:
                # Task finished
                pass
                
            idx += 1
            
        # Add rest of tasks
        remaining_tasks.extend(tasks_to_consider[idx:])
        
        plan[bucket.id] = bucket_plan
        
    return plan
