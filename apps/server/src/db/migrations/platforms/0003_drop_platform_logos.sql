-- Platform logos (an image the driver uploaded for a platform) were removed. They lived in this
-- table only, never as files, so dropping it removes every one; each badge shows the platform's
-- emoji or initials on its colour again. The platforms and their settings stay.
DROP TABLE platform_logos;
