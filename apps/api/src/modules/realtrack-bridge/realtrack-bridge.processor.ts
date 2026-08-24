import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RealtrackBridgeSelectionDto } from './realtrack-bridge.dto';
import { RealtrackBridgeService } from './realtrack-bridge.service';

type RealtrackBridgeTransferJob = {
  input: RealtrackBridgeSelectionDto;
};

/**
 * Transfer work runs in the dedicated worker so a 5,000-listing operation does
 * not hold an HTTP request open. The queue is intentionally single-concurrency
 * because the remote RealTrack write API rate-limits bursts.
 */
@Processor('realtrack-bridge', { concurrency: 1 })
export class RealtrackBridgeProcessor extends WorkerHost {
  constructor(private readonly bridge: RealtrackBridgeService) {
    super();
  }

  async process(job: Job<RealtrackBridgeTransferJob>) {
    return this.bridge.executeTransfer(job.data.input, undefined, (progress) =>
      job.updateProgress(progress),
    );
  }
}
