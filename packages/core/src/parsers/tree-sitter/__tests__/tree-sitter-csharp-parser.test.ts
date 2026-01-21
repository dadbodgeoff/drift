/**
 * Tree-sitter C# Parser Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { TreeSitterCSharpParser } from '../tree-sitter-csharp-parser.js';

describe('TreeSitterCSharpParser', () => {
  let parser: TreeSitterCSharpParser;
  let isAvailable: boolean;

  beforeAll(() => {
    isAvailable = TreeSitterCSharpParser.isAvailable();
    if (isAvailable) {
      parser = new TreeSitterCSharpParser();
    }
  });

  describe('availability', () => {
    it('should report availability status', () => {
      expect(typeof isAvailable).toBe('boolean');
    });

    it('should provide loading error if not available', () => {
      if (!isAvailable) {
        const error = TreeSitterCSharpParser.getLoadingError();
        expect(error).toBeTruthy();
      }
    });
  });

  describe('parsing', () => {
    it.skipIf(!TreeSitterCSharpParser.isAvailable())('should parse simple class', () => {
      const source = `
namespace MyApp;

public class User
{
    public int Id { get; set; }
    public string Name { get; set; }
}
`;
      const result = parser.parse(source);
      
      expect(result.success).toBe(true);
      expect(result.language).toBe('csharp');
      expect(result.classes).toHaveLength(1);
      expect(result.classes[0]?.name).toBe('User');
      expect(result.classes[0]?.properties).toHaveLength(2);
    });

    it.skipIf(!TreeSitterCSharpParser.isAvailable())('should parse using directives', () => {
      const source = `
using System;
using System.Collections.Generic;
using static System.Math;
`;
      const result = parser.parse(source);
      
      expect(result.success).toBe(true);
      expect(result.usings.length).toBeGreaterThanOrEqual(3);
      expect(result.usings.some(u => u.namespace === 'System')).toBe(true);
      expect(result.usings.some(u => u.isStatic)).toBe(true);
    });

    it.skipIf(!TreeSitterCSharpParser.isAvailable())('should parse attributes', () => {
      const source = `
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    [Authorize(Roles = "Admin")]
    public IActionResult GetAll()
    {
        return Ok();
    }
}
`;
      const result = parser.parse(source);
      
      expect(result.success).toBe(true);
      expect(result.classes).toHaveLength(1);
      
      const controller = result.classes[0]!;
      expect(controller.name).toBe('UsersController');
      expect(controller.attributes.some(a => a.name === 'ApiController')).toBe(true);
      expect(controller.attributes.some(a => a.name === 'Route')).toBe(true);
      
      expect(controller.methods).toHaveLength(1);
      const method = controller.methods[0]!;
      expect(method.name).toBe('GetAll');
      expect(method.attributes.some(a => a.name === 'HttpGet')).toBe(true);
      expect(method.attributes.some(a => a.name === 'Authorize')).toBe(true);
    });

    it.skipIf(!TreeSitterCSharpParser.isAvailable())('should parse records', () => {
      const source = `
public record UserDto(int Id, string Name, string Email);

public record OrderDto
{
    public int OrderId { get; init; }
    public decimal Total { get; init; }
}
`;
      const result = parser.parse(source);
      
      expect(result.success).toBe(true);
      expect(result.records.length).toBeGreaterThanOrEqual(1);
    });

    it.skipIf(!TreeSitterCSharpParser.isAvailable())('should parse interfaces', () => {
      const source = `
public interface IUserService
{
    Task<User> GetByIdAsync(int id);
    Task<IEnumerable<User>> GetAllAsync();
}
`;
      const result = parser.parse(source);
      
      expect(result.success).toBe(true);
      expect(result.interfaces).toHaveLength(1);
      expect(result.interfaces[0]?.name).toBe('IUserService');
      expect(result.interfaces[0]?.methods.length).toBeGreaterThanOrEqual(2);
    });

    it.skipIf(!TreeSitterCSharpParser.isAvailable())('should parse enums', () => {
      const source = `
public enum OrderStatus
{
    Pending = 0,
    Processing = 1,
    Shipped = 2,
    Delivered = 3
}
`;
      const result = parser.parse(source);
      
      expect(result.success).toBe(true);
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0]?.name).toBe('OrderStatus');
      expect(result.enums[0]?.members).toHaveLength(4);
    });

    it.skipIf(!TreeSitterCSharpParser.isAvailable())('should parse minimal API style', () => {
      const source = `
var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet("/users", () => Results.Ok());
app.MapPost("/users", (User user) => Results.Created());

app.Run();
`;
      const result = parser.parse(source);
      
      expect(result.success).toBe(true);
      expect(result.topLevelStatements).toBe(true);
    });

    it.skipIf(!TreeSitterCSharpParser.isAvailable())('should parse file-scoped namespace', () => {
      const source = `
namespace MyApp.Services;

public class UserService
{
    public void DoSomething() { }
}
`;
      const result = parser.parse(source);
      
      expect(result.success).toBe(true);
      expect(result.namespaces).toHaveLength(1);
      expect(result.namespaces[0]?.isFileScoped).toBe(true);
      expect(result.namespaces[0]?.name).toBe('MyApp.Services');
    });

    it.skipIf(!TreeSitterCSharpParser.isAvailable())('should parse async methods', () => {
      const source = `
public class DataService
{
    public async Task<List<Item>> GetItemsAsync()
    {
        return await Task.FromResult(new List<Item>());
    }
}
`;
      const result = parser.parse(source);
      
      expect(result.success).toBe(true);
      expect(result.classes).toHaveLength(1);
      
      const method = result.classes[0]?.methods[0];
      expect(method?.isAsync).toBe(true);
      expect(method?.name).toBe('GetItemsAsync');
    });

    it.skipIf(!TreeSitterCSharpParser.isAvailable())('should handle parse errors gracefully', () => {
      const source = `
public class Broken {
    public void Method( { // syntax error
    }
}
`;
      const result = parser.parse(source);
      
      // Should still return a result, possibly with errors
      expect(result.language).toBe('csharp');
    });
  });

  describe('metadata', () => {
    it('should have correct language', () => {
      const p = new TreeSitterCSharpParser();
      expect(p.language).toBe('csharp');
    });

    it('should have correct extensions', () => {
      const p = new TreeSitterCSharpParser();
      expect(p.extensions).toContain('.cs');
    });
  });
});
