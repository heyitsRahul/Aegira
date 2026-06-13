import { Controller, Get, Query } from '@nestjs/common';
import { COUNTRIES, DEFAULT_COUNTRY, HELPLINES, helplinesFor } from '../domain/reference';

/**
 * Public, unauthenticated reference data: the country/dial-code list and
 * official emergency helplines. No session data, no PII — safe to serve to
 * any client so the app and lite web render the same lists.
 */
@Controller('reference')
export class ReferenceController {
  @Get()
  all() {
    return { countries: COUNTRIES, defaultCountry: DEFAULT_COUNTRY, helplines: HELPLINES };
  }

  @Get('helplines')
  helplines(@Query('country') country?: string) {
    const resolved = country ?? DEFAULT_COUNTRY;
    return { country: resolved, helplines: helplinesFor(resolved) };
  }
}
