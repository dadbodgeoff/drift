// Quick test of Language Intelligence Layer
import { createLanguageIntelligence } from './packages/core/dist/index.js';
import * as fs from 'fs';
import * as path from 'path';

const intelligence = createLanguageIntelligence({ rootDir: process.cwd() });

// Test with a Spring Boot controller
const springCode = `
package com.example.demo;

import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Autowired;

@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @Autowired
    private UserService userService;
    
    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.findById(id);
    }
    
    @PostMapping
    public User createUser(@RequestBody User user) {
        return userService.save(user);
    }
}
`;

// Test with a FastAPI controller
const fastapiCode = `
from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session

app = FastAPI()

@app.get("/api/users/{user_id}")
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404)
    return user

@app.post("/api/users")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    return db.add(User(**user.dict()))
`;

// Test with NestJS controller
const nestjsCode = `
import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { UserService } from './user.service';

@Controller('users')
export class UserController {
    constructor(private readonly userService: UserService) {}
    
    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.userService.findOne(id);
    }
    
    @Post()
    create(@Body() createUserDto: CreateUserDto) {
        return this.userService.create(createUserDto);
    }
}
`;

console.log('=== Testing Language Intelligence Layer ===\n');

// Test Spring
console.log('--- Spring Boot (Java) ---');
const springResult = intelligence.normalizeFile(springCode, 'UserController.java');
if (springResult) {
    console.log('Detected frameworks:', springResult.detectedFrameworks);
    console.log('Functions:', springResult.functions.length);
    for (const fn of springResult.functions) {
        console.log(`  ${fn.name}: isEntryPoint=${fn.semantics.isEntryPoint}, entryPoint=${JSON.stringify(fn.semantics.entryPoint)}`);
    }
} else {
    console.log('No result for Spring');
}

console.log('\n--- FastAPI (Python) ---');
const fastapiResult = intelligence.normalizeFile(fastapiCode, 'main.py');
if (fastapiResult) {
    console.log('Detected frameworks:', fastapiResult.detectedFrameworks);
    console.log('Functions:', fastapiResult.functions.length);
    for (const fn of fastapiResult.functions) {
        console.log(`  ${fn.name}: isEntryPoint=${fn.semantics.isEntryPoint}, entryPoint=${JSON.stringify(fn.semantics.entryPoint)}`);
    }
} else {
    console.log('No result for FastAPI');
}

console.log('\n--- NestJS (TypeScript) ---');
const nestjsResult = intelligence.normalizeFile(nestjsCode, 'user.controller.ts');
if (nestjsResult) {
    console.log('Detected frameworks:', nestjsResult.detectedFrameworks);
    console.log('Functions:', nestjsResult.functions.length);
    for (const fn of nestjsResult.functions) {
        console.log(`  ${fn.name}: isEntryPoint=${fn.semantics.isEntryPoint}, entryPoint=${JSON.stringify(fn.semantics.entryPoint)}`);
    }
} else {
    console.log('No result for NestJS');
}

// Summary
console.log('\n=== Cross-Language Summary ===');
const allFiles = [springResult, fastapiResult, nestjsResult].filter(Boolean);
const entryPoints = intelligence.findEntryPoints(allFiles);
console.log(`Total entry points found across 3 languages: ${entryPoints.length}`);
for (const ep of entryPoints) {
    const file = allFiles.find(f => f.functions.includes(ep))?.file || 'unknown';
    const ext = path.extname(file);
    const lang = ext === '.java' ? 'Java/Spring' : ext === '.py' ? 'Python/FastAPI' : 'TypeScript/NestJS';
    console.log(`  [${lang}] ${ep.name}: ${ep.semantics.entryPoint?.methods?.join(',')} ${ep.semantics.entryPoint?.path || '/'}`);
}

const summary = intelligence.getSummary(allFiles);
console.log('\nSummary stats:');
console.log(`  Total functions: ${summary.totalFunctions}`);
console.log(`  Entry points: ${summary.entryPoints}`);
console.log(`  By framework:`, summary.byFramework);
console.log(`  By language:`, summary.byLanguage);
