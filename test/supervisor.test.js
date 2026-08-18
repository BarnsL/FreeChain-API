import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { restartDelayMs, superviseWorker } from '../src/supervisor.js';

class FakeWorker extends EventEmitter {
  kill(signal) {
    this.signal = signal;
    this.emit('exit', null, signal);
  }
}

test('restartDelayMs backs off from one second and caps at thirty', () => {
  assert.equal(restartDelayMs(1), 1_000);
  assert.equal(restartDelayMs(2), 2_000);
  assert.equal(restartDelayMs(10), 30_000);
});

test('superviseWorker restarts an unexpected exit and cancels a pending restart on stop', () => {
  const workers = [];
  const scheduled = [];
  const cancelled = [];
  let now = 0;
  const supervisor = superviseWorker({
    spawnWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    log: () => {},
    now: () => now,
    schedule: (callback, delay) => {
      const task = { callback, delay };
      scheduled.push(task);
      return task;
    },
    cancel: (task) => cancelled.push(task),
  });

  supervisor.start();
  assert.equal(workers.length, 1);

  workers[0].emit('exit', 1, null);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1_000);

  scheduled[0].callback();
  assert.equal(workers.length, 2);

  now += 500;
  workers[1].emit('exit', 1, null);
  assert.equal(scheduled[1].delay, 2_000);

  supervisor.stop();
  assert.deepEqual(cancelled, [scheduled[1]]);
  scheduled[1].callback();
  assert.equal(workers.length, 2);
});

test('supervisor stop resolves only after the active worker exits', async () => {
  const worker = new EventEmitter();
  worker.kill = (signal) => {
    worker.signal = signal;
  };
  const supervisor = superviseWorker({ spawnWorker: () => worker });
  supervisor.start();

  let settled = false;
  const stopping = supervisor.stop().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(worker.signal, 'SIGTERM');
  assert.equal(settled, false);

  worker.emit('exit', null, 'SIGTERM');
  await stopping;
  assert.equal(settled, true);
});
