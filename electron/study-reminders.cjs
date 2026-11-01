function isWithinQuietHours(settings, date = new Date()) {
  if (settings?.quietHoursEnabled !== true) return false;
  const parse = (value) => {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new TypeError('Quiet hours must use valid 24-hour times.');
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const start = parse(settings.quietStart);
  const end = parse(settings.quietEnd);
  if (start === end) throw new TypeError('Quiet hours must have different start and end times.');
  const current = date.getHours() * 60 + date.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

module.exports = { isWithinQuietHours };
