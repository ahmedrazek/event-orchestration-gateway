import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { EventDto } from './dtos/event.dto';
import { DLQ_QUEUE, EVENT_QUEUE } from './event-queue.constant';
import { DlqJobPayload } from './event.process';

@Processor(DLQ_QUEUE, {
  concurrency: 1,
})
export class EventDlqProcessor extends WorkerHost {
  constructor(
    @InjectQueue(EVENT_QUEUE)
    private readonly mainQueue: Queue<EventDto>,
  ) {
    super();
  }

  async process(job: Job<DlqJobPayload>) {
    const payload = job.data;
    if (!payload || typeof payload !== 'object' || !payload.event) {
      throw new Error('DLQ payload is missing event data');
    }

    const replayCount = Number(payload.replayCount ?? 0);
    const maxReplayCount = Number(payload.maxReplayCount ?? 1);
    if (replayCount >= maxReplayCount) {
      throw new Error('DLQ replay limit reached');
    }

    const event = payload.event;
    const mainJobId = `event-${event.eventId}`;
    const existingMainJob = await this.mainQueue.getJob(mainJobId);
    if (existingMainJob) {
      const state = await existingMainJob.getState();
      if (state === 'active') {
        throw new Error('DLQ replay blocked: target main queue job is active');
      }
      await existingMainJob.remove();
    }

    await this.mainQueue.add(event.eventId, event, { jobId: mainJobId });
    await job.updateData({
      ...payload,
      replayCount: replayCount + 1,
      replayedAt: new Date().toISOString(),
    });

    return {
      status: 'replayed',
      eventId: event.eventId,
      replayCount: replayCount + 1,
    };
  }
}
