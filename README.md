# 机场地面保障调度管理系统

面向航班机位分配、廊桥调度、行李转运、货物装卸、航空加油、航食配餐与客舱清洁全流程的机场地面保障调度管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出、跨模块联动
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化与初始化
│   ├── src/stores/           会话与筛选状态
│   ├── .env.development      本地开发环境变量
│   ├── .env.production       部署构建环境变量（与开发同一份值）
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）+ 版本指纹注入
├── .env.example              环境变量模板：本地、构建、docker-compose 共用这一份
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

容器部署（构建生产包后用 `vite preview` 提供服务，同样监听 5173）：

```bash
docker compose up --build
```

## 环境、示例数据与初始化约定

- **环境只有一份**：`.env.example` 是环境变量模板，`frontend/.env.development`（本地开发）与
  `frontend/.env.production`（部署构建）的值与它保持一致，docker-compose 也直接引用它；
  要改就一起改，不允许某个环境私藏一份配置。
- **示例数据只有一份**：全部在 `frontend/src/data/seed.ts`，本地开发与部署构建都从它播种。
  各模块的「关联航班 / 涉及航班」都对应航班保障里的航班号（CA1831 / MU5152 / CZ3901），
  转运编号、行李件数、到达转盘等详情字段在列表与详情里是同一份，不会再对不上。
- **数据库初始化只有一条路径**：`frontend/src/data/local-store.ts` 的 `initializeStore()`。
  播种版本 = 应用版本 + 依赖版本指纹 + 示例数据内容指纹，任一变化（比如依赖版本变化后重建）
  都会整库重播，不会把上一版的旧转运状态再显示出来。
- **反复装载不多出记录**：装载按 `id` upsert，重复执行、刷新、重开都只会补缺，不会重复播种。
- **失败从异常行续做**：装载时若某行的「关联航班 / 涉及航班」在航班保障里找不到（依赖缺失），
  就停在该异常行并记下游标，页面会说明缺的是哪个依赖；修复后自动（或点行李转运页上的
  「从异常行续做」按钮）从这一行继续，已装载的记录不会重复。
- **跨模块联动**：行李转运「确认到达 / 标记异常」后，同一航班的航班保障清单会同步到达结论
  （保障节点写上到达转盘或异常滞留，保障状态跟随转运结论）。

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
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `airport-ground-handling:entries` 这一项，或调用 `resetModule(模块)`；
  播种相关的版本、游标与报告分别在 `airport-ground-handling:seed-version` /
  `airport-ground-handling:seed-checkpoint` / `airport-ground-handling:seed-report`。
