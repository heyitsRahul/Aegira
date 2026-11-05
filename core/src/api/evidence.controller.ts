import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { AudioUpload, ClipInfo, EvidenceService } from '../services/evidence.service';
import { SessionService } from '../services/session.service';
import { SESSION_SERVICE } from './session.controller';

export const EVIDENCE_SERVICE = 'EVIDENCE_SERVICE';

const bearer = (header: string | undefined): string | null =>
  header?.startsWith('Bearer ') ? header.slice(7) : null;

const EXTENSION: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
};

/**
 * Opt-in sound recording (consent v8). Thin like every controller:
 * authorize, then delegate.
 *  - upload: the helpseeker's device (Bearer seeker token)
 *  - listen: the helpseeker (Bearer) or a trusted contact (?t= from the
 *    alert link, so an <audio> tag on the no-JS contact page can play it)
 * There is deliberately no responder route (invariant 6).
 */
@Controller('sessions')
export class EvidenceController {
  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(EVIDENCE_SERVICE) private readonly evidence: EvidenceService,
  ) {}

  @Post(':id/audio')
  upload(@Param('id') id: string, @Body() body: AudioUpload, @Headers('authorization') auth?: string) {
    this.sessions.authorizeSeeker(id, bearer(auth));
    return this.evidence.append(id, body ?? ({} as AudioUpload));
  }

  @Get(':id/audio')
  list(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
    @Query('t') token?: string,
  ): { clips: ClipInfo[] } {
    const clips =
      this.role(id, auth, token) === 'seeker'
        ? this.evidence.listForSeeker(id)
        : this.evidence.listForContact(id);
    return { clips };
  }

  @Get(':id/audio/:segment')
  clip(
    @Param('id') id: string,
    @Param('segment') segment: string,
    @Headers('authorization') auth?: string,
    @Query('t') token?: string,
  ): StreamableFile {
    const clip =
      this.role(id, auth, token) === 'seeker'
        ? this.evidence.clipForSeeker(id, segment)
        : this.evidence.clipForContact(id, segment);
    if (clip === null) {
      throw new NotFoundException({ error: 'no such recording' });
    }
    return new StreamableFile(clip.bytes, {
      type: clip.mime,
      length: clip.bytes.length,
      disposition: `inline; filename="aegira-recording-${segment}.${EXTENSION[clip.mime] ?? 'audio'}"`,
    });
  }

  private role(id: string, auth: string | undefined, token: string | undefined): 'seeker' | 'contact' {
    const seekerToken = bearer(auth);
    if (seekerToken !== null) {
      this.sessions.authorizeSeeker(id, seekerToken);
      return 'seeker';
    }
    this.sessions.authorizeContact(id, token ?? null);
    return 'contact';
  }
}
