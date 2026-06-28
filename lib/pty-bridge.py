#!/usr/bin/env python3
"""
pty-bridge.py - Spawn a command in a real PTY, bridge stdin/stdout.

This is the PTY layer for pty-manager.mjs. It replaces node-pty
without needing any native Node.js addons.

Usage: python3 pty-bridge.py <cmd> [args...]

stdin  -> written to PTY master (send-keys)
stdout <- read from PTY master (capture-pane)
stderr <- status messages (pid, exit code)

The child process sees a real terminal (isatty() = True).
"""

import pty
import os
import sys
import select
import signal
import struct
import fcntl
import termios
import errno

def set_winsize(fd, rows=50, cols=200):
    """Set terminal window size."""
    winsize = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

def main():
    if len(sys.argv) < 2:
        sys.stderr.write("usage: python3 pty-bridge.py [--size COLSxROWS] <cmd> [args...]\n")
        sys.exit(1)

    args = sys.argv[1:]
    rows, cols = 50, 200

    # parse --size flag
    if args[0] == '--size' and len(args) >= 3:
        try:
            parts = args[1].split('x')
            cols = int(parts[0])
            rows = int(parts[1])
        except (ValueError, IndexError):
            pass
        args = args[2:]

    cmd = args

    # create pty pair
    master_fd, slave_fd = pty.openpty()

    # set terminal size
    set_winsize(master_fd, rows, cols)

    # fork
    pid = os.fork()

    if pid == 0:
        # child: connect to slave side of pty
        os.close(master_fd)
        os.setsid()

        # make slave the controlling terminal
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)

        # redirect stdio to slave
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)

        if slave_fd > 2:
            os.close(slave_fd)

        # set TERM
        os.environ['TERM'] = 'xterm-256color'

        # strip BASH_FUNC_* exported functions — these are bash internals
        # that corrupt child shells (cause subshell failures in every session
        # when a stale daemon environment propagates them forward)
        for _key in list(os.environ.keys()):
            if _key.startswith('BASH_FUNC_'):
                del os.environ[_key]

        # ensure erase char matches what xterm.js sends (DEL / 0x7f)
        # macOS xterm-256color terminfo has kbs=^H which mismatches
        attrs = termios.tcgetattr(0)
        attrs[6][termios.VERASE] = b'\x7f'[0]
        termios.tcsetattr(0, termios.TCSANOW, attrs)

        # exec the command
        os.execvp(cmd[0], cmd)
        # never reaches here

    # parent: bridge stdin/stdout with master
    os.close(slave_fd)

    # report child pid on stderr
    sys.stderr.write(f"PID:{pid}\n")
    sys.stderr.flush()

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()

    # set master to non-blocking (reads are guarded by select, but the fd
    # is non-blocking so EAGAIN is safe on spurious wakeups)
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    # set stdin to non-blocking
    flags = fcntl.fcntl(stdin_fd, fcntl.F_GETFL)
    fcntl.fcntl(stdin_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    # handle SIGCHLD
    child_exited = [False]
    child_status = [0]

    def on_sigchld(signum, frame):
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                child_exited[0] = True
                if os.WIFEXITED(status):
                    child_status[0] = os.WEXITSTATUS(status)
                else:
                    child_status[0] = -1
        except ChildProcessError:
            child_exited[0] = True

    signal.signal(signal.SIGCHLD, on_sigchld)

    # handle window size changes
    def on_sigwinch(signum, frame):
        # forward to child's pty if we get resized
        pass

    signal.signal(signal.SIGWINCH, on_sigwinch)

    # track which fds to watch; stdin is dropped on EOF so we never busy-spin
    # on a closed pipe while the child is still running
    watch_fds = [master_fd, stdin_fd]

    def _drain_master():
        """Read and forward any remaining bytes on the pty master."""
        try:
            while True:
                data = os.read(master_fd, 4096)
                if not data:
                    break
                os.write(stdout_fd, data)
        except (OSError, IOError):
            pass

    try:
        while True:
            # Block indefinitely until the pty or stdin has data, or a signal
            # (SIGCHLD on child exit) interrupts us.  No timeout = 0% CPU when
            # the child is idle.  SIGCHLD fires → InterruptedError → drain & break.
            try:
                rfds, _, _ = select.select(watch_fds, [], [])
            except (InterruptedError, select.error):
                if child_exited[0]:
                    _drain_master()
                    break
                continue

            if master_fd in rfds:
                try:
                    data = os.read(master_fd, 4096)
                    if not data:
                        break
                    os.write(stdout_fd, data)
                except OSError as e:
                    if e.errno == errno.EIO:
                        # child closed its side of the pty
                        break
                    if e.errno != errno.EAGAIN:
                        raise

            if stdin_fd in rfds:
                try:
                    data = os.read(stdin_fd, 4096)
                    if not data:
                        # stdin EOF — stop watching to avoid a busy-spin on the
                        # closed fd while we wait for the child to finish
                        watch_fds = [f for f in watch_fds if f != stdin_fd]
                    else:
                        os.write(master_fd, data)
                except OSError as e:
                    if e.errno == errno.EAGAIN:
                        pass
                    else:
                        # unreadable — drop stdin from watch list
                        watch_fds = [f for f in watch_fds if f != stdin_fd]

            if child_exited[0]:
                _drain_master()
                break

    except KeyboardInterrupt:
        os.kill(pid, signal.SIGTERM)

    finally:
        os.close(master_fd)

    # wait for child if not already done
    if not child_exited[0]:
        try:
            _, status = os.waitpid(pid, 0)
            if os.WIFEXITED(status):
                child_status[0] = os.WEXITSTATUS(status)
        except ChildProcessError:
            pass

    sys.stderr.write(f"EXIT:{child_status[0]}\n")
    sys.stderr.flush()
    sys.exit(child_status[0])

if __name__ == '__main__':
    main()
