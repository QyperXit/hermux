export const RECENT_ROWS = 5;
export const FULL_ROWS = 3;
// Of the idle agents, only the most recently active (highest state_change_seq)
// are read by default, never all of them: Activity's recent rows, plus spare
// reads for idle agents that sit in the Inbox as finished, so a first load
// usually has every line.
const FINISHED_IDLE_SPARE_READS = 3;
export const RECENT_IDLE_READS = RECENT_ROWS + FINISHED_IDLE_SPARE_READS;
