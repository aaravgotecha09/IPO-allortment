/*
 * Makes stdout unbuffered BEFORE main() runs, so the Node.js API server
 * can read every prompt and result from the C program immediately when it
 * is connected through a pipe. ipo.c itself is not modified.
 */
#include <stdio.h>

__attribute__((constructor))
static void make_stdout_unbuffered(void)
{
    setvbuf(stdout, NULL, _IONBF, 0);
}
