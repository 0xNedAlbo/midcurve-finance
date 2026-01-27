/**
 * Business Logic Configuration
 *
 * Environment-based configuration for the business logic service.
 */

/**
 * RabbitMQ configuration
 */
export interface RabbitMQConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  vhost?: string;
}

/**
 * Get RabbitMQ configuration from environment
 */
export function getRabbitMQConfig(): RabbitMQConfig {
  return {
    host: process.env.RABBITMQ_HOST || 'localhost',
    port: parseInt(process.env.RABBITMQ_PORT || '5672', 10),
    username: process.env.RABBITMQ_USER || 'midcurve',
    password: process.env.RABBITMQ_PASS || 'midcurve_dev',
    vhost: process.env.RABBITMQ_VHOST,
  };
}
