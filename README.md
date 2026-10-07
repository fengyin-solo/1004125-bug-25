# 机场地面保障调度管理系统

面向航班机位分配、廊桥调度、行李转运、货物装卸、航空加油、航食配餐与客舱清洁全流程的机场地面保障调度管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 数据初始化（本地与部署共用一份逻辑）

所有环境的数据初始化统一走 `frontend/src/data/bootstrap.ts`，只有这一份播种逻辑：

- **幂等**：按各模块第一个字段（转运编号、航班号等业务键）upsert，反复装载不会多出记录。
- **版本收敛**：`seed.ts` 里的 `SEED_VERSION` 随示例数据变化递增；本地缓存版本不一致时按
  种子收敛（同键覆盖、废键清除），依赖升级重建后不会再残留旧转运状态。
- **断点续做**：每装一行推进一次断点并落盘，中断后下次从异常行继续，已装载的行不重复。
- **依赖校验**：行李转运的「关联航班」必须存在于航班保障的「航班号」里（航班保障先装载）。
  缺依赖时装载停在该行，错误说明缺什么、停在哪，页面会展示该提示。
- **跨模块联动**：行李转运「确认到达」后，到达结论（保障节点/保障状态）自动同步到
  航班保障清单里同一航班的记录；联动规则登记在 `local-service.ts` 的 `SYNC_RULES`。

数据层自检（不依赖浏览器，覆盖幂等、续做、依赖缺失、版本迁移、联动同步）：

```bash
cd frontend
npm run selfcheck
```

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、跨模块联动、导出
│   ├── src/data/             模块元数据 / 示例数据 / 统一初始化（bootstrap）/ localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   ├── scripts/selfcheck.ts  数据层自检（npm run selfcheck）
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm ci        # 按 package-lock.json 严格安装，和部署构建同一批依赖版本
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建与本地预览：

```bash
cd frontend
npm run build
npm run preview
```

Docker 部署（多阶段构建：`npm ci` → 生产构建 → `vite preview` 伺服 dist，端口同为 5173）：

```bash
docker compose up --build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 机位分配 | `stand` | 机位分配 | 机位编号、机位类型、所属航站楼 |
| 廊桥调度 | `bridge` | 廊桥 | 廊桥编号、所属机位、对接机型 |
| 地面电源 | `ground_power` | 地面电源 | 设备编号、设备类型、所属机位 |
| 行李转运 | `baggage` | 行李转运 | 转运编号、关联航班、行李件数 |
| 货物装卸 | `cargo` | 货物装卸 | 装卸编号、关联航班、货物品类 |
| 航空加油 | `fueling` | 加油记录 | 加油编号、关联航班、燃油型号 |
| 航食配餐 | `catering` | 配餐任务 | 配餐编号、关联航班、餐食类型 |
| 客舱清洁 | `cabin_clean` | 清洁任务 | 清洁编号、关联航班、清洁类型 |
| 排污服务 | `lavatory` | 排污记录 | 排污编号、关联航班、服务车型 |
| 除冰作业 | `deicing` | 除冰记录 | 除冰编号、关联航班、除冰液类型 |
| 牵引车调度 | `pushback` | 牵引任务 | 牵引编号、关联航班、牵引车型 |
| 地勤排班 | `crew_schedule` | 地勤人员 | 人员编号、姓名、岗位类别 |
| 特种车辆 | `special_vehicle` | 特种车辆 | 车辆编号、车辆类型、品牌型号 |
| 航班保障 | `flight_ops` | 航班保障 | 航班号、机尾号、计划到港 |
| 过站监控 | `turnaround` | 过站记录 | 过站编号、关联航班、计划到港 |
| 机坪安全 | `apron_safety` | 机坪安全 | 巡查编号、巡查区域、巡查人员 |
| 装卸设备 | `load_equip` | 装卸设备 | 设备编号、设备类型、适用机型 |
| 应急保障 | `air_emergency` | 应急保障 | 应急编号、事件类型、涉及航班 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据与数据版本在
  `frontend/src/data/seed.ts`；初始化（幂等、断点续做、依赖校验、版本收敛）在
  `frontend/src/data/bootstrap.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断；跨模块联动规则
  （如行李到达 → 航班保障清单）也登记在 `local-service.ts`。
- 想回到初始数据：清掉浏览器里 `airport-ground-handling:entries` 这一项，或调用 `resetModule(模块)`。
