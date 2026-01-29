#!/usr/bin/env npx ts-node
/**
 * Generate a large synthetic codebase for stress testing
 * 
 * Creates ~1500+ files with realistic code patterns to test:
 * - Call graph building (OOM prevention)
 * - Pattern detection at scale
 * - Memory usage under load
 * 
 * Usage: npx ts-node scripts/generate-large-codebase.ts [output-dir] [file-count]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const OUTPUT_DIR = process.argv[2] || 'test-repos/large-synthetic';
const FILE_COUNT = parseInt(process.argv[3] || '1500', 10);

// Templates for generating realistic code
const SERVICE_TEMPLATE = (name: string, imports: string[], calls: string[]) => `
import { Injectable } from '@nestjs/common';
${imports.map(i => `import { ${i}Service } from './${i.toLowerCase()}.service';`).join('\n')}

@Injectable()
export class ${name}Service {
  constructor(
    ${imports.map(i => `private readonly ${i.toLowerCase()}Service: ${i}Service,`).join('\n    ')}
  ) {}

  async findAll(): Promise<${name}[]> {
    ${calls.map(c => `await this.${c.toLowerCase()}Service.validate();`).join('\n    ')}
    return this.repository.find();
  }

  async findOne(id: string): Promise<${name} | null> {
    return this.repository.findOne({ where: { id } });
  }

  async create(data: Create${name}Dto): Promise<${name}> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(id: string, data: Update${name}Dto): Promise<${name}> {
    await this.repository.update(id, data);
    return this.findOne(id);
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  private async validate(): Promise<boolean> {
    return true;
  }
}

interface ${name} {
  id: string;
  name: string;
  createdAt: Date;
}

interface Create${name}Dto {
  name: string;
}

interface Update${name}Dto {
  name?: string;
}
`;

const CONTROLLER_TEMPLATE = (name: string) => `
import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { ${name}Service } from './${name.toLowerCase()}.service';

@Controller('${name.toLowerCase()}s')
export class ${name}Controller {
  constructor(private readonly ${name.toLowerCase()}Service: ${name}Service) {}

  @Get()
  async findAll() {
    return this.${name.toLowerCase()}Service.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.${name.toLowerCase()}Service.findOne(id);
  }

  @Post()
  async create(@Body() data: any) {
    return this.${name.toLowerCase()}Service.create(data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.${name.toLowerCase()}Service.update(id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.${name.toLowerCase()}Service.delete(id);
  }
}
`;

const UTIL_TEMPLATE = (name: string, helpers: string[]) => `
/**
 * ${name} utilities
 */

${helpers.map(h => `
export function ${h}(input: unknown): unknown {
  if (!input) return null;
  return process${h.charAt(0).toUpperCase() + h.slice(1)}(input);
}

function process${h.charAt(0).toUpperCase() + h.slice(1)}(data: unknown): unknown {
  return data;
}
`).join('\n')}

export const ${name.toUpperCase()}_CONFIG = {
  enabled: true,
  timeout: 5000,
  retries: 3,
};
`;

const REACT_COMPONENT_TEMPLATE = (name: string, hooks: string[]) => `
import React, { useState, useEffect } from 'react';
${hooks.map(h => `import { use${h} } from '../hooks/use${h}';`).join('\n')}

interface ${name}Props {
  id: string;
  onUpdate?: (data: unknown) => void;
}

export const ${name}: React.FC<${name}Props> = ({ id, onUpdate }) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<unknown>(null);
  ${hooks.map(h => `const { data: ${h.toLowerCase()}Data } = use${h}(id);`).join('\n  ')}

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await fetch(\`/api/${name.toLowerCase()}/\${id}\`);
      const result = await response.json();
      setData(result);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    onUpdate?.(data);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="${name.toLowerCase()}-container">
      <h1>${name}</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={handleSubmit}>Update</button>
    </div>
  );
};

export default ${name};
`;

const HOOK_TEMPLATE = (name: string) => `
import { useState, useEffect, useCallback } from 'react';

interface Use${name}Result {
  data: unknown;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function use${name}(id?: string): Use${name}Result {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(\`/api/${name.toLowerCase()}/\${id}\`);
      if (!response.ok) throw new Error('Failed to fetch');
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
`;

const PYTHON_SERVICE_TEMPLATE = (name: string) => `
from typing import Optional, List
from dataclasses import dataclass
from datetime import datetime

@dataclass
class ${name}:
    id: str
    name: str
    created_at: datetime

class ${name}Service:
    def __init__(self, db_session):
        self.db = db_session

    async def find_all(self) -> List[${name}]:
        return await self.db.query(${name}).all()

    async def find_one(self, id: str) -> Optional[${name}]:
        return await self.db.query(${name}).filter_by(id=id).first()

    async def create(self, data: dict) -> ${name}:
        entity = ${name}(**data)
        self.db.add(entity)
        await self.db.commit()
        return entity

    async def update(self, id: str, data: dict) -> Optional[${name}]:
        entity = await self.find_one(id)
        if entity:
            for key, value in data.items():
                setattr(entity, key, value)
            await self.db.commit()
        return entity

    async def delete(self, id: str) -> bool:
        entity = await self.find_one(id)
        if entity:
            self.db.delete(entity)
            await self.db.commit()
            return True
        return False
`;

// Entity names for generating files
const ENTITIES = [
  'User', 'Product', 'Order', 'Payment', 'Invoice', 'Customer', 'Vendor',
  'Category', 'Tag', 'Comment', 'Review', 'Rating', 'Notification', 'Message',
  'Thread', 'Channel', 'Workspace', 'Team', 'Project', 'Task', 'Milestone',
  'Sprint', 'Epic', 'Story', 'Bug', 'Feature', 'Release', 'Deployment',
  'Environment', 'Config', 'Setting', 'Preference', 'Profile', 'Account',
  'Session', 'Token', 'Permission', 'Role', 'Policy', 'Audit', 'Log',
  'Metric', 'Alert', 'Dashboard', 'Report', 'Export', 'Import', 'Sync',
  'Webhook', 'Integration', 'Connection', 'Credential', 'Secret', 'Key',
];

const UTILS = [
  'string', 'number', 'date', 'array', 'object', 'validation', 'format',
  'parse', 'transform', 'filter', 'sort', 'group', 'aggregate', 'cache',
  'retry', 'timeout', 'debounce', 'throttle', 'queue', 'batch', 'stream',
];

const HOOKS = [
  'Auth', 'User', 'Data', 'Form', 'Modal', 'Toast', 'Theme', 'Locale',
  'Storage', 'Network', 'Scroll', 'Resize', 'Click', 'Keyboard', 'Focus',
];

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function generateFiles() {
  console.log(`\n🏗️  Generating ${FILE_COUNT} files in ${OUTPUT_DIR}...\n`);
  
  const rootDir = path.resolve(OUTPUT_DIR);
  ensureDir(rootDir);
  
  // Create .driftignore
  fs.writeFileSync(path.join(rootDir, '.driftignore'), 'node_modules\ndist\n.git\n');
  
  // Create package.json
  fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({
    name: 'large-synthetic-codebase',
    version: '1.0.0',
    description: 'Synthetic codebase for stress testing',
  }, null, 2));
  
  let fileCount = 0;
  const targetCount = FILE_COUNT;
  
  // Generate backend services
  const servicesDir = path.join(rootDir, 'src', 'services');
  ensureDir(servicesDir);
  
  for (let i = 0; i < ENTITIES.length && fileCount < targetCount; i++) {
    const entity = ENTITIES[i];
    const imports = ENTITIES.slice(Math.max(0, i - 3), i);
    const calls = imports.slice(0, 2);
    
    fs.writeFileSync(
      path.join(servicesDir, `${entity.toLowerCase()}.service.ts`),
      SERVICE_TEMPLATE(entity, imports, calls)
    );
    fileCount++;
    
    if (fileCount % 100 === 0) {
      console.log(`  Generated ${fileCount}/${targetCount} files...`);
    }
  }
  
  // Generate controllers
  const controllersDir = path.join(rootDir, 'src', 'controllers');
  ensureDir(controllersDir);
  
  for (const entity of ENTITIES) {
    if (fileCount >= targetCount) break;
    fs.writeFileSync(
      path.join(controllersDir, `${entity.toLowerCase()}.controller.ts`),
      CONTROLLER_TEMPLATE(entity)
    );
    fileCount++;
  }
  
  // Generate utils
  const utilsDir = path.join(rootDir, 'src', 'utils');
  ensureDir(utilsDir);
  
  for (const util of UTILS) {
    if (fileCount >= targetCount) break;
    const helpers = [`validate${util}`, `format${util}`, `parse${util}`, `transform${util}`];
    fs.writeFileSync(
      path.join(utilsDir, `${util}.utils.ts`),
      UTIL_TEMPLATE(util, helpers)
    );
    fileCount++;
  }
  
  // Generate React components
  const componentsDir = path.join(rootDir, 'src', 'components');
  ensureDir(componentsDir);
  
  for (const entity of ENTITIES) {
    if (fileCount >= targetCount) break;
    const hooks = HOOKS.slice(0, Math.floor(Math.random() * 3) + 1);
    fs.writeFileSync(
      path.join(componentsDir, `${entity}.tsx`),
      REACT_COMPONENT_TEMPLATE(entity, hooks)
    );
    fileCount++;
  }
  
  // Generate hooks
  const hooksDir = path.join(rootDir, 'src', 'hooks');
  ensureDir(hooksDir);
  
  for (const hook of HOOKS) {
    if (fileCount >= targetCount) break;
    fs.writeFileSync(
      path.join(hooksDir, `use${hook}.ts`),
      HOOK_TEMPLATE(hook)
    );
    fileCount++;
  }
  
  // Generate Python services
  const pythonDir = path.join(rootDir, 'api', 'services');
  ensureDir(pythonDir);
  
  for (const entity of ENTITIES) {
    if (fileCount >= targetCount) break;
    fs.writeFileSync(
      path.join(pythonDir, `${entity.toLowerCase()}_service.py`),
      PYTHON_SERVICE_TEMPLATE(entity)
    );
    fileCount++;
  }
  
  // Generate more files by duplicating with variations
  const modules = ['auth', 'billing', 'analytics', 'notifications', 'search', 'admin', 'api', 'core'];
  
  for (const module of modules) {
    if (fileCount >= targetCount) break;
    
    const moduleDir = path.join(rootDir, 'src', 'modules', module);
    ensureDir(moduleDir);
    
    for (const entity of ENTITIES) {
      if (fileCount >= targetCount) break;
      
      const imports = ENTITIES.slice(0, Math.floor(Math.random() * 5));
      fs.writeFileSync(
        path.join(moduleDir, `${entity.toLowerCase()}.${module}.ts`),
        SERVICE_TEMPLATE(`${module}${entity}`, imports, imports.slice(0, 2))
      );
      fileCount++;
      
      if (fileCount % 100 === 0) {
        console.log(`  Generated ${fileCount}/${targetCount} files...`);
      }
    }
  }
  
  // Fill remaining with more variations
  let variation = 0;
  while (fileCount < targetCount) {
    const entity = ENTITIES[variation % ENTITIES.length];
    const suffix = Math.floor(variation / ENTITIES.length);
    const moduleDir = path.join(rootDir, 'src', 'generated', `batch${suffix}`);
    ensureDir(moduleDir);
    
    const imports = ENTITIES.slice(0, Math.floor(Math.random() * 3));
    fs.writeFileSync(
      path.join(moduleDir, `${entity.toLowerCase()}_v${suffix}.service.ts`),
      SERVICE_TEMPLATE(`${entity}V${suffix}`, imports, [])
    );
    fileCount++;
    variation++;
    
    if (fileCount % 100 === 0) {
      console.log(`  Generated ${fileCount}/${targetCount} files...`);
    }
  }
  
  console.log(`\n✅ Generated ${fileCount} files in ${OUTPUT_DIR}`);
  console.log(`\nTo test call graph building:`);
  console.log(`  cd ${OUTPUT_DIR}`);
  console.log(`  drift init --yes`);
  console.log(`  drift callgraph build`);
  console.log(`\nOr with the new --callgraph flag:`);
  console.log(`  drift scan --callgraph`);
}

generateFiles();
