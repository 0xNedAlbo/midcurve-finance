/**
 * UserService Tests
 *
 * Unit tests for UserService CRUD operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@prisma/client';
import { UserService } from './user-service.js';
import { ALICE, BOB, CHARLIE } from './test-fixtures.js';

describe('UserService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let userService: UserService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    userService = new UserService({ prisma: prismaMock });
  });

  describe('create', () => {
    it('should create a user successfully', async () => {
      // Arrange
      prismaMock.user.create.mockResolvedValue(ALICE.dbResult);

      // Act
      const result = await userService.create(ALICE.input);

      // Assert
      expect(result).toEqual(ALICE.dbResult);
      expect(prismaMock.user.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: {
          name: ALICE.input.name,
        },
      });
    });

    it('should create user with simple name', async () => {
      // Arrange
      prismaMock.user.create.mockResolvedValue(BOB.dbResult);

      // Act
      const result = await userService.create(BOB.input);

      // Assert
      expect(result.name).toBe('Bob');
      expect(result.id).toBe('user_bob_001');
    });

    it('should create user with long name', async () => {
      // Arrange
      prismaMock.user.create.mockResolvedValue(CHARLIE.dbResult);

      // Act
      const result = await userService.create(CHARLIE.input);

      // Assert
      expect(result.name).toBe('Charlie Thompson');
      expect(result.id).toBe('user_charlie_001');
    });
  });

  describe('findById', () => {
    it('should find user by id', async () => {
      // Arrange
      prismaMock.user.findUnique.mockResolvedValue(ALICE.dbResult);

      // Act
      const result = await userService.findById('user_alice_001');

      // Assert
      expect(result).toEqual(ALICE.dbResult);
      expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user_alice_001' },
      });
    });

    it('should return null if user not found', async () => {
      // Arrange
      prismaMock.user.findUnique.mockResolvedValue(null);

      // Act
      const result = await userService.findById('nonexistent_id');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findByName', () => {
    it('should find user by name', async () => {
      // Arrange
      prismaMock.user.findFirst.mockResolvedValue(ALICE.dbResult);

      // Act
      const result = await userService.findByName('Alice');

      // Assert
      expect(result).toEqual(ALICE.dbResult);
      expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: { name: 'Alice' },
      });
    });

    it('should return null if user not found by name', async () => {
      // Arrange
      prismaMock.user.findFirst.mockResolvedValue(null);

      // Act
      const result = await userService.findByName('Nonexistent');

      // Assert
      expect(result).toBeNull();
    });

    it('should find user with long name', async () => {
      // Arrange
      prismaMock.user.findFirst.mockResolvedValue(CHARLIE.dbResult);

      // Act
      const result = await userService.findByName('Charlie Thompson');

      // Assert
      expect(result).toEqual(CHARLIE.dbResult);
      expect(result?.name).toBe('Charlie Thompson');
    });
  });

  describe('update', () => {
    it('should update user name', async () => {
      // Arrange
      const updatedUser = {
        ...ALICE.dbResult,
        name: 'Alice Smith',
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      };
      prismaMock.user.update.mockResolvedValue(updatedUser);

      // Act
      const result = await userService.update('user_alice_001', {
        name: 'Alice Smith',
      });

      // Assert
      expect(result.name).toBe('Alice Smith');
      expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user_alice_001' },
        data: { name: 'Alice Smith' },
      });
    });

    it('should handle partial updates', async () => {
      // Arrange
      const updatedUser = {
        ...BOB.dbResult,
        updatedAt: new Date('2024-01-03T00:00:00.000Z'),
      };
      prismaMock.user.update.mockResolvedValue(updatedUser);

      // Act
      const result = await userService.update('user_bob_001', {});

      // Assert
      expect(result.id).toBe('user_bob_001');
      expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('should delete user', async () => {
      // Arrange
      prismaMock.user.delete.mockResolvedValue(ALICE.dbResult);

      // Act
      const result = await userService.delete('user_alice_001');

      // Assert
      expect(result).toEqual(ALICE.dbResult);
      expect(prismaMock.user.delete).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.delete).toHaveBeenCalledWith({
        where: { id: 'user_alice_001' },
      });
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      // Arrange
      const allUsers = [ALICE.dbResult, BOB.dbResult, CHARLIE.dbResult];
      prismaMock.user.findMany.mockResolvedValue(allUsers);

      // Act
      const result = await userService.findAll();

      // Assert
      expect(result).toEqual(allUsers);
      expect(result).toHaveLength(3);
      expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array if no users', async () => {
      // Arrange
      prismaMock.user.findMany.mockResolvedValue([]);

      // Act
      const result = await userService.findAll();

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('constructor', () => {
    it('should accept custom prisma client', () => {
      // Arrange & Act
      const customService = new UserService({ prisma: prismaMock });

      // Assert
      expect(customService).toBeInstanceOf(UserService);
    });

    it('should work without dependencies (uses default PrismaClient)', () => {
      // Arrange & Act
      const defaultService = new UserService();

      // Assert
      expect(defaultService).toBeInstanceOf(UserService);
    });
  });
});
