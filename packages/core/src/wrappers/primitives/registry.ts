/**
 * Framework Primitive Registry
 *
 * Bootstrap definitions of framework primitives across all supported languages.
 * These are the "building blocks" that developers commonly wrap.
 */

import type { PrimitiveRegistry, SupportedLanguage } from '../types.js';

// =============================================================================
// TypeScript/JavaScript Primitives
// =============================================================================

export const REACT_PRIMITIVES: PrimitiveRegistry = {
  react: {
    state: ['useState', 'useReducer'],
    effect: ['useEffect', 'useLayoutEffect', 'useInsertionEffect'],
    context: ['useContext', 'createContext'],
    ref: ['useRef', 'useImperativeHandle', 'forwardRef'],
    memo: ['useMemo', 'useCallback', 'memo'],
    concurrent: ['useTransition', 'useDeferredValue', 'useId'],
    external: ['useSyncExternalStore'],
    actions: ['useActionState', 'useFormStatus', 'useOptimistic', 'use'],
  },
};

export const REACT_ECOSYSTEM_PRIMITIVES: PrimitiveRegistry = {
  'tanstack-query': {
    query: ['useQuery', 'useMutation', 'useInfiniteQuery', 'useQueryClient', 'useSuspenseQuery'],
  },
  swr: {
    query: ['useSWR', 'useSWRMutation', 'useSWRInfinite', 'useSWRConfig'],
  },
  apollo: {
    query: ['useQuery', 'useMutation', 'useLazyQuery', 'useSubscription', 'useApolloClient'],
  },
  urql: {
    query: ['useQuery', 'useMutation', 'useSubscription', 'useClient'],
  },
  'rtk-query': {
    query: ['useGetQuery', 'useLazyGetQuery', 'useMutation'],
  },
  redux: {
    state: ['useSelector', 'useDispatch', 'useStore'],
  },
  zustand: {
    state: ['useStore', 'create', 'createStore'],
  },
  jotai: {
    state: ['useAtom', 'useAtomValue', 'useSetAtom', 'atom'],
  },
  recoil: {
    state: ['useRecoilState', 'useRecoilValue', 'useSetRecoilState', 'useRecoilCallback'],
  },
  valtio: {
    state: ['useSnapshot', 'useProxy'],
  },
  'mobx-react': {
    state: ['useObserver', 'useLocalObservable'],
  },
  'react-hook-form': {
    form: ['useForm', 'useWatch', 'useFieldArray', 'useFormContext', 'useController'],
  },
  formik: {
    form: ['useFormik', 'useField', 'useFormikContext'],
  },
  'react-router': {
    routing: ['useNavigate', 'useParams', 'useLocation', 'useSearchParams', 'useMatch', 'useOutlet'],
  },
  next: {
    routing: ['useRouter', 'usePathname', 'useSearchParams', 'useParams', 'useSelectedLayoutSegment'],
  },
  'framer-motion': {
    animation: ['useAnimation', 'useMotionValue', 'useTransform', 'useSpring', 'useScroll'],
  },
  'react-spring': {
    animation: ['useSpring', 'useSprings', 'useTrail', 'useTransition', 'useChain'],
  },
};


export const VUE_PRIMITIVES: PrimitiveRegistry = {
  vue: {
    reactivity: ['ref', 'reactive', 'computed', 'watch', 'watchEffect', 'watchPostEffect', 'watchSyncEffect'],
    lifecycle: ['onMounted', 'onUpdated', 'onUnmounted', 'onBeforeMount', 'onBeforeUpdate', 'onBeforeUnmount'],
    di: ['provide', 'inject'],
    composition: ['defineComponent', 'defineProps', 'defineEmits', 'defineExpose', 'defineSlots'],
  },
  'vue-router': {
    routing: ['useRouter', 'useRoute', 'useLink'],
  },
  pinia: {
    state: ['defineStore', 'storeToRefs', 'useStore'],
  },
};

export const SVELTE_PRIMITIVES: PrimitiveRegistry = {
  svelte: {
    stores: ['writable', 'readable', 'derived', 'get'],
    lifecycle: ['onMount', 'onDestroy', 'beforeUpdate', 'afterUpdate', 'tick'],
    context: ['setContext', 'getContext', 'hasContext', 'getAllContexts'],
    motion: ['tweened', 'spring'],
  },
};

export const ANGULAR_PRIMITIVES: PrimitiveRegistry = {
  angular: {
    di: ['inject', 'Injectable', 'Inject', 'Optional', 'Self', 'SkipSelf', 'Host'],
    signals: ['signal', 'computed', 'effect'],
    lifecycle: ['OnInit', 'OnDestroy', 'OnChanges', 'AfterViewInit', 'AfterContentInit'],
    http: ['HttpClient', 'HttpInterceptor'],
    router: ['Router', 'ActivatedRoute', 'RouterLink'],
    forms: ['FormBuilder', 'FormGroup', 'FormControl', 'Validators'],
  },
};

export const EXPRESS_PRIMITIVES: PrimitiveRegistry = {
  express: {
    middleware: ['use', 'Router', 'json', 'urlencoded', 'static'],
    request: ['req.body', 'req.params', 'req.query', 'req.headers', 'req.cookies'],
    response: ['res.json', 'res.send', 'res.status', 'res.redirect', 'res.render'],
  },
};

export const JS_TESTING_PRIMITIVES: PrimitiveRegistry = {
  jest: {
    test: ['describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'],
    mock: ['jest.fn', 'jest.mock', 'jest.spyOn'],
  },
  vitest: {
    test: ['describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach'],
    mock: ['vi.fn', 'vi.mock', 'vi.spyOn'],
  },
  '@testing-library/react': {
    test: ['render', 'screen', 'fireEvent', 'waitFor', 'within', 'act'],
  },
  cypress: {
    test: ['cy.visit', 'cy.get', 'cy.contains', 'cy.click', 'cy.type', 'cy.intercept'],
  },
  playwright: {
    test: ['page.goto', 'page.click', 'page.fill', 'page.locator', 'expect'],
  },
};

// =============================================================================
// Python Primitives
// =============================================================================

export const FASTAPI_PRIMITIVES: PrimitiveRegistry = {
  fastapi: {
    di: ['Depends', 'Security'],
    params: ['Query', 'Path', 'Body', 'Header', 'Cookie', 'Form', 'File', 'UploadFile'],
    auth: ['HTTPBearer', 'HTTPBasic', 'OAuth2PasswordBearer', 'OAuth2PasswordRequestForm', 'APIKeyHeader', 'APIKeyCookie'],
    background: ['BackgroundTasks'],
    response: ['Response', 'JSONResponse', 'HTMLResponse', 'StreamingResponse', 'FileResponse', 'RedirectResponse'],
    websocket: ['WebSocket', 'WebSocketDisconnect'],
  },
};

export const DJANGO_PRIMITIVES: PrimitiveRegistry = {
  django: {
    views: ['View', 'TemplateView', 'ListView', 'DetailView', 'CreateView', 'UpdateView', 'DeleteView'],
    shortcuts: ['get_object_or_404', 'get_list_or_404', 'redirect', 'render', 'reverse'],
    decorators: ['login_required', 'permission_required', 'user_passes_test', 'require_http_methods', 'csrf_exempt'],
    db: ['transaction.atomic', 'connection.cursor', 'F', 'Q', 'Prefetch', 'Count', 'Sum', 'Avg'],
    cache: ['cache.get', 'cache.set', 'cache.delete', 'cache_page', 'cache_control'],
    signals: ['Signal', 'receiver', 'post_save', 'pre_save', 'post_delete', 'pre_delete'],
    forms: ['Form', 'ModelForm', 'formset_factory', 'modelformset_factory'],
  },
  'django-rest-framework': {
    views: ['APIView', 'ViewSet', 'ModelViewSet'],
    serializers: ['Serializer', 'ModelSerializer'],
    permissions: ['IsAuthenticated', 'IsAdminUser', 'AllowAny'],
  },
};

export const FLASK_PRIMITIVES: PrimitiveRegistry = {
  flask: {
    core: ['Flask', 'Blueprint', 'request', 'g', 'session', 'current_app'],
    decorators: ['route', 'before_request', 'after_request', 'errorhandler', 'context_processor'],
    response: ['jsonify', 'make_response', 'redirect', 'url_for', 'render_template', 'send_file'],
  },
  'flask-login': {
    auth: ['login_required', 'current_user', 'login_user', 'logout_user'],
  },
  'flask-wtf': {
    forms: ['FlaskForm', 'CSRFProtect'],
  },
  'flask-sqlalchemy': {
    db: ['SQLAlchemy', 'db.session', 'db.Model'],
  },
};

export const SQLALCHEMY_PRIMITIVES: PrimitiveRegistry = {
  sqlalchemy: {
    session: ['Session', 'sessionmaker', 'scoped_session'],
    query: ['select', 'insert', 'update', 'delete', 'join', 'outerjoin'],
    orm: ['relationship', 'backref', 'column_property', 'hybrid_property', 'validates'],
    types: ['Column', 'Integer', 'String', 'Boolean', 'DateTime', 'ForeignKey', 'Table'],
  },
};

export const CELERY_PRIMITIVES: PrimitiveRegistry = {
  celery: {
    tasks: ['task', 'shared_task', 'Task'],
    execution: ['delay', 'apply_async', 'signature', 'chain', 'group', 'chord'],
    scheduling: ['periodic_task', 'crontab', 'schedule'],
  },
};

export const PYDANTIC_PRIMITIVES: PrimitiveRegistry = {
  pydantic: {
    models: ['BaseModel', 'Field', 'validator', 'root_validator', 'model_validator'],
    settings: ['BaseSettings', 'SettingsConfigDict'],
    types: ['constr', 'conint', 'confloat', 'EmailStr', 'HttpUrl', 'SecretStr'],
  },
};

export const PYTHON_TESTING_PRIMITIVES: PrimitiveRegistry = {
  pytest: {
    fixtures: ['fixture', 'mark.parametrize', 'mark.skip', 'mark.asyncio', 'raises', 'approx', 'monkeypatch'],
  },
  unittest: {
    test: ['TestCase', 'setUp', 'tearDown'],
    mock: ['mock.patch', 'mock.MagicMock', 'mock.Mock'],
  },
  hypothesis: {
    test: ['given', 'strategies', 'settings', 'example'],
  },
};


// =============================================================================
// Java Primitives
// =============================================================================

export const SPRING_PRIMITIVES: PrimitiveRegistry = {
  spring: {
    di: ['@Autowired', '@Inject', '@Resource', '@Qualifier', '@Value', 'getBean', 'getBeanProvider'],
    stereotypes: ['@Component', '@Service', '@Repository', '@Controller', '@RestController', '@Configuration'],
    web: ['@RequestMapping', '@GetMapping', '@PostMapping', '@PutMapping', '@DeleteMapping', '@PatchMapping'],
    params: ['@RequestBody', '@PathVariable', '@RequestParam', '@RequestHeader', '@CookieValue', '@ModelAttribute'],
    response: ['ResponseEntity', '@ResponseBody', '@ResponseStatus'],
    data: ['@Transactional', '@Query', '@Modifying', '@EntityGraph', '@Lock'],
    jpa: ['JpaRepository', 'CrudRepository', 'PagingAndSortingRepository', 'save', 'findById', 'findAll', 'delete', 'deleteById'],
    aop: ['@Aspect', '@Before', '@After', '@Around', '@AfterReturning', '@AfterThrowing', 'ProceedingJoinPoint'],
    security: ['@PreAuthorize', '@PostAuthorize', '@Secured', '@RolesAllowed', 'SecurityContextHolder', 'Authentication'],
    async: ['@Async', '@EnableAsync', 'CompletableFuture', '@Scheduled', '@EnableScheduling'],
    validation: ['@Valid', '@Validated', '@NotNull', '@NotBlank', '@Size', '@Min', '@Max', '@Pattern'],
    caching: ['@Cacheable', '@CacheEvict', '@CachePut', '@Caching', '@EnableCaching'],
  },
  'spring-boot': {
    config: ['@SpringBootApplication', '@EnableAutoConfiguration', '@ConfigurationProperties', '@ConditionalOnProperty'],
    actuator: ['@Endpoint', '@ReadOperation', '@WriteOperation', 'HealthIndicator'],
    testing: ['@SpringBootTest', '@WebMvcTest', '@DataJpaTest', '@MockBean', '@SpyBean', 'TestRestTemplate'],
  },
};

export const JAVA_TESTING_PRIMITIVES: PrimitiveRegistry = {
  junit5: {
    test: ['@Test', '@BeforeEach', '@AfterEach', '@BeforeAll', '@AfterAll', '@DisplayName', '@Nested', '@ParameterizedTest', '@ValueSource'],
  },
  mockito: {
    mock: ['@Mock', '@InjectMocks', '@Spy', '@Captor', 'when', 'verify', 'doReturn', 'doThrow', 'ArgumentCaptor'],
  },
  assertj: {
    assert: ['assertThat', 'assertThatThrownBy', 'assertThatCode'],
  },
};

// =============================================================================
// C# / .NET Primitives
// =============================================================================

export const ASPNET_PRIMITIVES: PrimitiveRegistry = {
  aspnet: {
    di: ['GetService', 'GetRequiredService', 'AddScoped', 'AddSingleton', 'AddTransient', 'AddHostedService'],
    attributes: ['[FromServices]', '[FromBody]', '[FromQuery]', '[FromRoute]', '[FromHeader]', '[FromForm]'],
    middleware: ['IMiddleware', 'RequestDelegate', 'Use', 'UseMiddleware', 'Map', 'MapWhen', 'UseWhen'],
    mvc: ['[HttpGet]', '[HttpPost]', '[HttpPut]', '[HttpDelete]', '[HttpPatch]', '[Route]', '[ApiController]', 'ControllerBase'],
    results: ['Ok', 'BadRequest', 'NotFound', 'Created', 'NoContent', 'Unauthorized', 'Forbid'],
    auth: ['[Authorize]', '[AllowAnonymous]', 'IAuthorizationService', 'ClaimsPrincipal', '[RequiresClaim]'],
    validation: ['[Required]', '[StringLength]', '[Range]', '[RegularExpression]', '[Compare]', 'ModelState'],
    config: ['IConfiguration', 'IOptions', 'IOptionsSnapshot', 'IOptionsMonitor', 'Configure'],
    logging: ['ILogger', 'ILoggerFactory', 'LogInformation', 'LogWarning', 'LogError', 'LogDebug'],
  },
};

export const EFCORE_PRIMITIVES: PrimitiveRegistry = {
  efcore: {
    context: ['DbContext', 'DbSet', 'SaveChanges', 'SaveChangesAsync'],
    query: ['Include', 'ThenInclude', 'Where', 'Select', 'OrderBy', 'GroupBy', 'Join', 'AsNoTracking'],
    raw: ['FromSqlRaw', 'FromSqlInterpolated', 'ExecuteSqlRaw', 'ExecuteSqlInterpolated'],
    transactions: ['BeginTransaction', 'CommitTransaction', 'RollbackTransaction', 'Database.BeginTransactionAsync'],
  },
};

export const CSHARP_TESTING_PRIMITIVES: PrimitiveRegistry = {
  xunit: {
    test: ['[Fact]', '[Theory]', '[InlineData]', '[ClassData]', '[MemberData]', 'Assert'],
  },
  nunit: {
    test: ['[Test]', '[TestCase]', '[SetUp]', '[TearDown]', '[TestFixture]', 'Assert'],
  },
  moq: {
    mock: ['Mock', 'Setup', 'Returns', 'Verify', 'It.IsAny', 'It.Is', 'Callback'],
  },
  fluentassertions: {
    assert: ['Should', 'BeEquivalentTo', 'Contain', 'HaveCount', 'Throw'],
  },
};

// =============================================================================
// PHP Primitives
// =============================================================================

export const LARAVEL_PRIMITIVES: PrimitiveRegistry = {
  laravel: {
    facades: ['Auth::', 'Cache::', 'DB::', 'Log::', 'Queue::', 'Storage::', 'Event::', 'Mail::', 'Notification::', 'Gate::'],
    di: ['app()', 'resolve()', 'make()', 'bind', 'singleton', 'instance'],
    eloquent: ['query', 'where', 'with', 'find', 'first', 'get', 'save', 'create', 'update', 'delete'],
    relations: ['hasMany', 'belongsTo', 'hasOne', 'belongsToMany', 'morphTo', 'morphMany', 'morphToMany', 'hasManyThrough'],
    request: ['input', 'validated', 'user', 'file', 'has', 'only'],
    response: ['response', 'redirect', 'view', 'back', 'abort'],
    middleware: ['handle', 'terminate'],
    validation: ['Validator::make', 'validate', 'Rule::unique', 'Rule::exists', 'Rule::in'],
    events: ['event', 'Event::dispatch', 'Listener', 'ShouldQueue'],
    jobs: ['dispatch', 'dispatchSync', 'Bus::dispatch', 'Bus::chain'],
    auth: ['Auth::user', 'Auth::check', 'Auth::attempt', 'Gate::allows', 'Gate::denies', 'authorize'],
  },
};

export const SYMFONY_PRIMITIVES: PrimitiveRegistry = {
  symfony: {
    di: ['#[Autowire]', '#[Required]', 'ContainerInterface', 'ServiceSubscriberInterface'],
    routing: ['#[Route]', '#[Get]', '#[Post]', '#[Put]', '#[Delete]'],
    forms: ['FormBuilderInterface', 'createForm', 'handleRequest', 'isSubmitted', 'isValid'],
    doctrine: ['EntityManagerInterface', 'persist', 'flush', 'remove', 'getRepository'],
    security: ['#[IsGranted]', 'Security', 'UserInterface', 'PasswordHasherInterface'],
    events: ['EventDispatcherInterface', 'EventSubscriberInterface', '#[AsEventListener]'],
  },
};

export const PHP_TESTING_PRIMITIVES: PrimitiveRegistry = {
  phpunit: {
    test: ['TestCase', 'setUp', 'tearDown', 'assertEquals', 'assertTrue', 'assertFalse', 'expectException', 'createMock'],
  },
  pest: {
    test: ['test', 'it', 'expect', 'beforeEach', 'afterEach', 'uses'],
  },
  'laravel-testing': {
    test: ['RefreshDatabase', 'WithFaker', 'actingAs', 'assertDatabaseHas', 'assertDatabaseMissing', 'mock'],
  },
};


// =============================================================================
// Combined Registry by Language
// =============================================================================

export const TYPESCRIPT_PRIMITIVES: PrimitiveRegistry = {
  ...REACT_PRIMITIVES,
  ...REACT_ECOSYSTEM_PRIMITIVES,
  ...VUE_PRIMITIVES,
  ...SVELTE_PRIMITIVES,
  ...ANGULAR_PRIMITIVES,
  ...EXPRESS_PRIMITIVES,
  ...JS_TESTING_PRIMITIVES,
};

export const PYTHON_PRIMITIVES: PrimitiveRegistry = {
  ...FASTAPI_PRIMITIVES,
  ...DJANGO_PRIMITIVES,
  ...FLASK_PRIMITIVES,
  ...SQLALCHEMY_PRIMITIVES,
  ...CELERY_PRIMITIVES,
  ...PYDANTIC_PRIMITIVES,
  ...PYTHON_TESTING_PRIMITIVES,
};

export const JAVA_PRIMITIVES: PrimitiveRegistry = {
  ...SPRING_PRIMITIVES,
  ...JAVA_TESTING_PRIMITIVES,
};

export const CSHARP_PRIMITIVES: PrimitiveRegistry = {
  ...ASPNET_PRIMITIVES,
  ...EFCORE_PRIMITIVES,
  ...CSHARP_TESTING_PRIMITIVES,
};

export const PHP_PRIMITIVES: PrimitiveRegistry = {
  ...LARAVEL_PRIMITIVES,
  ...SYMFONY_PRIMITIVES,
  ...PHP_TESTING_PRIMITIVES,
};

export const ALL_PRIMITIVES: Record<SupportedLanguage, PrimitiveRegistry> = {
  typescript: TYPESCRIPT_PRIMITIVES,
  python: PYTHON_PRIMITIVES,
  java: JAVA_PRIMITIVES,
  csharp: CSHARP_PRIMITIVES,
  php: PHP_PRIMITIVES,
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get all primitive names for a language
 */
export function getPrimitiveNames(language: SupportedLanguage): Set<string> {
  const registry = ALL_PRIMITIVES[language];
  const names = new Set<string>();

  for (const framework of Object.values(registry)) {
    for (const category of Object.values(framework)) {
      for (const name of category) {
        names.add(name);
      }
    }
  }

  return names;
}

/**
 * Get all framework names for a language
 */
export function getFrameworkNames(language: SupportedLanguage): string[] {
  return Object.keys(ALL_PRIMITIVES[language]);
}

/**
 * Find which framework a primitive belongs to
 */
export function findPrimitiveFramework(
  primitiveName: string,
  language: SupportedLanguage
): { framework: string; category: string } | null {
  const registry = ALL_PRIMITIVES[language];

  for (const [framework, categories] of Object.entries(registry)) {
    for (const [category, names] of Object.entries(categories)) {
      if (names.includes(primitiveName)) {
        return { framework, category };
      }
    }
  }

  return null;
}

/**
 * Check if a name looks like a primitive based on naming conventions
 */
export function looksLikePrimitive(name: string, language: SupportedLanguage): boolean {
  // React hooks
  if (language === 'typescript' && name.startsWith('use') && name.length > 3) {
    return true;
  }

  // Common primitive patterns
  const prefixes = ['create', 'make', 'build', 'get', 'set', 'with', 'define'];
  if (prefixes.some((p) => name.toLowerCase().startsWith(p.toLowerCase()))) {
    return true;
  }

  // Decorators/annotations
  if (name.startsWith('@') || name.startsWith('#[') || name.startsWith('[')) {
    return true;
  }

  // Python decorators
  if (language === 'python' && /^[a-z_]+$/.test(name) && name.length < 20) {
    return true;
  }

  return false;
}

/**
 * Get the total count of primitives for a language
 */
export function getPrimitiveCount(language: SupportedLanguage): number {
  return getPrimitiveNames(language).size;
}

/**
 * Get primitives by category across all frameworks for a language
 */
export function getPrimitivesByCategory(
  language: SupportedLanguage
): Map<string, string[]> {
  const registry = ALL_PRIMITIVES[language];
  const byCategory = new Map<string, string[]>();

  for (const categories of Object.values(registry)) {
    for (const [category, names] of Object.entries(categories)) {
      const existing = byCategory.get(category) || [];
      byCategory.set(category, [...existing, ...names]);
    }
  }

  return byCategory;
}
