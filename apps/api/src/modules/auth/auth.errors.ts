export class AuthEmailExistsError extends Error {
  constructor() {
    super('User email already exists');
    this.name = 'AuthEmailExistsError';
  }
}

export class AuthOrganizationSlugExistsError extends Error {
  constructor() {
    super('Organization slug already exists');
    this.name = 'AuthOrganizationSlugExistsError';
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('Invalid refresh token');
    this.name = 'InvalidRefreshTokenError';
  }
}

export class RefreshTokenReplayError extends InvalidRefreshTokenError {
  constructor() {
    super();
    this.name = 'RefreshTokenReplayError';
  }
}
