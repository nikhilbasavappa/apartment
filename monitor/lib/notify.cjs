const { execFileSync } = require("child_process");

function escapeAppleScript(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function notifyMac(title, subtitle, message) {
  execFileSync("/usr/bin/osascript", [
    "-e",
    `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(
      title
    )}" subtitle "${escapeAppleScript(subtitle)}"`,
  ]);
}

function maybeOpenReport(reportPath) {
  execFileSync("/usr/bin/open", [reportPath]);
}

function sendNotifications(report, config) {
  if (!config.notifications?.enabled) {
    return;
  }

  const matches = report.newListings.filter((entry) => entry.qualifies);
  if (!matches.length) {
    return;
  }

  const top = matches[0];
  const officeMinutes = top.commute?.office?.minutes;
  const subtitle = officeMinutes ? `${officeMinutes} min to office` : "Qualifying listing";
  const message = `${top.listing.title}${matches.length > 1 ? ` + ${matches.length - 1} more` : ""}`;

  notifyMac("Apartment Monitor", subtitle, message);

  if (config.notifications.openReportOnHits) {
    maybeOpenReport(report.htmlPath);
  }
}

module.exports = {
  sendNotifications,
};
