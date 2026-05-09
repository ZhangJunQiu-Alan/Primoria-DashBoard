import { describe, expect, it } from 'vitest'
import { getGoogleCalendarEmbedSrc } from '@/lib/googleCalendarEmbed'

describe('GoogleCalendarWidget embed parsing', () => {
  it('extracts Google Calendar iframe src', () => {
    const src = getGoogleCalendarEmbedSrc(
      '<iframe src="https://calendar.google.com/calendar/embed?src=test%40gmail.com&amp;ctz=Asia%2FShanghai" width="800" height="600"></iframe>'
    )

    expect(src).toBe('https://calendar.google.com/calendar/embed?src=test%40gmail.com&ctz=Asia%2FShanghai')
  })

  it('accepts a direct Google Calendar embed URL', () => {
    const src = getGoogleCalendarEmbedSrc(
      'https://calendar.google.com/calendar/u/0/embed?src=test%40gmail.com&ctz=Asia%2FShanghai'
    )

    expect(src).toBe('https://calendar.google.com/calendar/u/0/embed?src=test%40gmail.com&ctz=Asia%2FShanghai')
  })

  it('rejects non-calendar iframe sources', () => {
    expect(getGoogleCalendarEmbedSrc('<iframe src="https://example.com"></iframe>')).toBeNull()
  })
})
