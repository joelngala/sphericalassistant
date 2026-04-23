// Same Web Application OAuth client ID used by the React app and the Worker
// (GOOGLE_CLIENT_ID in wrangler.toml). The extension's chromiumapp.org
// redirect URI must also be registered on this client in the Google Cloud
// console — see README.
export const OAUTH_CLIENT_ID = '873310561840-mlkjkmhkva583s71spj8ufqc31bavun7.apps.googleusercontent.com';

export const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

export const ROOT_FOLDER_NAME = 'Spherical Assistant';
