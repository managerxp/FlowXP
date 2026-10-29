-- Mail now goes out through the platform's own mailbox (set in the server environment); a business keeps only its switch, reply-to and copy preference.
ALTER TABLE email_settings DROP COLUMN host, DROP COLUMN port, DROP COLUMN secure, DROP COLUMN username, DROP COLUMN password_enc, DROP COLUMN from_email;
