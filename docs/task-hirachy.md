# Task hierarchy

Tasks in Plina can have subtasks. Subtasks flesh out what excactly 
needs to be done to finish the main task. The workflow is most of
the time to add a big task with a time estimate of a couple of hours.
After the idea takes shape it becomes possible to plan out the big 
task in more detail and the user adds subtasks with their own time 
estimates spanning over quarter or half hours. The total time is 
summed up in the main task and a dummy task with the remaining time 
is displayed if the time does not add up to the estimate of the main
task. If the dummy task would have a negative time it gets 
highlighted with a warning. There's a button next to the time 
estimate of the big task to set it's total time to the sum of time
of it's subtasks. So this easy option to remove the warning or the
dummy task is easily available.

Each Task object has a parent property. If the parent is None the 
task is on the root level. If it has subtasks it is considered to 
be a project and projects are displayed in their own page of the 
interface. If a task has subtasks and a parent task not None it is
considered a sub-project (the display of those can be toggled in 
the projects page). Tasks can be embedded indefinitely building a 
tree. Setting a parent that would produce a circle in the tree is
illegal and gets rejected by the backend and an error is displayed 
in the frontend.

In the dependency editor projects can be selected as filters. This 
reduces the number of nodes on screen and makes it easier to 
define the dependency graph. Tasks with subtasks have a clickable 
tree icon that leads directly to the dependency editor with the 
filter for this project or sub-project already set.
