# Plina e2e test cases

## Alice

Alice visits the front page and is asked for authentication. She chooses "Digisoul Account (OAuth2)" and is redirected to auth.digisoul-lab.de (this is mocked in the e2e test). She authenticates and is redirected to her dashboard. She goes to "Time Buckets" and creates four time buckets with the tag "HomeOffice": Mo 9:00 to 12:00, Mo 13:00 to 18:00, Fr 9:00 to 12:00 and Fr 13:00 to 18:00. She then adds two with the tag "TrainOffice": Tu 8:30 to 12:00 and Th 15:00 to 18:30. After that she adds two with the tag "PhD-Meeting" on Th 9:30 to 12:00 and Th 13:00 to 15:00. She then adds to with the tag "Teaching" on Tu 13:00 to 17:30 and on We 9:00 to 12:00. Then she adds one with the tag "Research" on We from 13:00 to 18:00. All of these time buckets repeat every week at the same time.
After the time buckets are set she navigates to Tasks and adds an appointment "Professors Lunch" on We 12:00 with duration 1.5h. Then she adds the appointment "Team meeting" on Thursday at 11:00 with a duration of 1 hour 15 minutes. She then adds the tasks "PhD meeting Bob", "PhD meeting Claire", "PhD meeting Dennis" with the tag "PhD-Meeting" and a duration of 30 minutes each. She then adds a task "XYZ-Proposal" with a time estimate of 17 hours and she selects the tag "Research". She then immediately splits this into subtasks "References" (5h), "Writing" (8h) and "Introduction" (4h). She then adds "Proof reading" below and assigns it to the user "Nida". She also adds "Work package planning" and places it in the dependency graph behind "References" but as a dependency of "Writing". She assigns "Work package planning" to the user "Dennis". She then adds the task "Notify Dennis" with a duration of 10 min and sets this new task as a dependency for "Work package planning".

The planned week of Alice starts with "Notify Dennis" on monday morning at 9:00.

## Pina

Pina authenticates and navigates to "Projects". "Projects" is a page displaying all tasks that have subtasks. She then creates the project/task "T250" with the tag "maker" and starts to enter subtasks:
- "print bed frame" (duration 15min)
- "route wires" (duration 2h)
- "flash mainboard" (duration 1h)
- "flash pi" (duration 1h)
- "install cpap" (duration 1h)
- "test hotend" (duration 30min)
- "test bed" (duration 15min)
- "test fans" (duration 30min)
- "configure klipper" (duration 2h)
- "first test print" (duration 2h)
- "speed tuning" (duration 4h)
She then opens the details of "print bed frame" and clicks on "Add Dependency" there. In the input field she enters "order high temperature filament". She then opens the projects dependencies and sees that only "order high temperature filament" must happen before "print bed frame". She then adds "route wires", "flash mainboard" and "flash pi" as dependecies for "test hotend". Then she adds "print bed frame", "route wires", "flash mainboard" and "flash pi" as dependencies for "test bed". Then she adds "route wires", "flash mainboard" and "flash pi" as dependencies for "test fans". She sets "test hotend", "test bed" and "test fans" as a dependency for "configure klipper". Then she sets "configure klipper" as a dependency for "first test print" and "first test print" as a dependency for "speed tuning". In the dependency node editor she sees that "test hotend", "test bed" and "test fans" can happen simultaneously but "speed tuning" is only possible if everything else is finished.